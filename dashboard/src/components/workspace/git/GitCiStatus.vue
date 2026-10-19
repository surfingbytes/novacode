<script setup lang="ts">
// node_modules
import { computed } from 'vue';
import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Wrench
} from 'lucide-vue-next';

// utils
import { ciResultVerb, ciRunLabel, forgeProviderLabel } from '@/utils/ciStatusDisplay';
import { relativeTimeShort } from '@/utils/relativeTime';

// types
import type { CiRun, CiStatusResponse } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  status: CiStatusResponse | null;
  bLoading: boolean;
  /** Show "Fix with agent" for a failed last build (only inside a session). */
  bCanFix: boolean;
  bFixing: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  fix: [run: CiRun];
}>();

// -------------------------------------------------- Computed --------------------------------------------------
const bVisible = computed((): boolean => Boolean(props.status?.configured && (props.status.repo || props.status.error)));
const runsUrl = computed((): string | null => props.status?.runsUrl ?? props.status?.repoUrl ?? null);
const sourceTitle = computed((): string => {
  const s = props.status;
  if (!s) return '';
  const where = s.connectionName ?? (s.provider ? forgeProviderLabel(s.provider) : 'forge');
  return `${where} · ${s.repoSource === 'override' ? 'set in workspace settings' : 'detected from the git remote'}`;
});
const hiddenQueued = computed((): number =>
  props.status ? Math.max(0, props.status.queuedTotal - props.status.queued.length) : 0
);
const bIdle = computed(
  (): boolean => !!props.status && props.status.running.length === 0 && props.status.queuedTotal === 0
);

function runTime(run: CiRun): string {
  const at = run.updatedAt ?? run.createdAt;
  return at ? relativeTimeShort(at) : '';
}
</script>

<template>
  <div v-if="bVisible && status" class="mt-2 border-t border-fg/[0.06] pt-2 px-2 text-xs">
    <div class="flex items-center justify-between gap-2">
      <a
        v-if="runsUrl"
        :href="runsUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="min-w-0 truncate font-medium text-text-muted hover:text-text-primary"
        :title="sourceTitle"
      >
        CI<template v-if="status.provider"> · {{ forgeProviderLabel(status.provider) }}</template> ·
        <span class="font-mono">{{ status.repo }}</span>
      </a>
      <span v-else class="font-medium text-text-muted">CI</span>
      <button
        type="button"
        class="text-text-muted hover:text-text-primary transition-colors p-0.5 flex-shrink-0"
        :class="{ 'animate-spin': bLoading }"
        title="Refresh CI status"
        aria-label="Refresh CI status"
        @click="emit('refresh')"
      >
        <RefreshCw :size="12" :stroke-width="1.6" class="select-none" aria-hidden="true" />
      </button>
    </div>

    <p v-if="status.error" class="mt-1 text-destructive break-words">{{ status.error }}</p>

    <ul v-else class="mt-1 space-y-1">
      <li v-for="run in status.running" :key="`r-${run.id}`" class="flex items-center gap-1.5 min-w-0">
        <LoaderCircle :size="13" :stroke-width="1.8" class="select-none flex-shrink-0 text-primary animate-spin" aria-hidden="true" />
        <span class="flex-shrink-0 text-text-primary">Running {{ ciRunLabel(run) }}</span>
        <span class="min-w-0 truncate text-text-muted">{{ run.title }}</span>
        <a v-if="run.url" :href="run.url" target="_blank" rel="noopener noreferrer" class="ml-auto flex-shrink-0 text-text-muted hover:text-text-primary" title="Open run">
          <ExternalLink :size="12" :stroke-width="1.6" aria-hidden="true" />
        </a>
      </li>
      <li v-for="run in status.queued" :key="`q-${run.id}`" class="flex items-center gap-1.5 min-w-0">
        <Clock :size="13" :stroke-width="1.8" class="select-none flex-shrink-0 text-text-muted" aria-hidden="true" />
        <span class="flex-shrink-0 text-text-primary">Queued {{ ciRunLabel(run) }}</span>
        <span class="min-w-0 truncate text-text-muted">{{ run.title }}</span>
        <a v-if="run.url" :href="run.url" target="_blank" rel="noopener noreferrer" class="ml-auto flex-shrink-0 text-text-muted hover:text-text-primary" title="Open run">
          <ExternalLink :size="12" :stroke-width="1.6" aria-hidden="true" />
        </a>
      </li>
      <li v-if="hiddenQueued > 0" class="pl-5 text-text-muted">+{{ hiddenQueued }} more queued</li>

      <li v-if="status.lastCompleted" class="flex items-center gap-1.5 min-w-0">
        <CircleCheck v-if="status.lastCompleted.status === 'success'" :size="13" :stroke-width="1.8" class="select-none flex-shrink-0 text-success" aria-hidden="true" />
        <CircleX v-else-if="status.lastCompleted.status === 'failure'" :size="13" :stroke-width="1.8" class="select-none flex-shrink-0 text-destructive" aria-hidden="true" />
        <CircleSlash v-else :size="13" :stroke-width="1.8" class="select-none flex-shrink-0 text-text-muted" aria-hidden="true" />
        <span class="flex-shrink-0" :class="bIdle ? 'text-text-primary' : 'text-text-muted'">
          {{ bIdle ? 'Last build' : 'Previous' }} {{ ciRunLabel(status.lastCompleted) }} {{ ciResultVerb(status.lastCompleted) }}
        </span>
        <span class="min-w-0 truncate text-text-muted">{{ runTime(status.lastCompleted) }}</span>
        <a
          v-if="status.lastCompleted.url"
          :href="status.lastCompleted.url"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-auto flex-shrink-0 text-text-muted hover:text-text-primary"
          title="Open run"
        >
          <ExternalLink :size="12" :stroke-width="1.6" aria-hidden="true" />
        </a>
      </li>
      <li v-else-if="bIdle" class="text-text-muted">
        No builds{{ status.branch ? ` for ${status.branch}` : '' }} yet
      </li>
    </ul>

    <button
      v-if="bCanFix && !status.error && status.lastCompleted?.status === 'failure'"
      type="button"
      class="mt-2 h-7 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/25 text-destructive hover:bg-destructive/[0.06] hover:border-destructive/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="bFixing"
      @click="emit('fix', status.lastCompleted)"
    >
      <LoaderCircle v-if="bFixing" :size="13" :stroke-width="1.8" class="animate-spin" aria-hidden="true" />
      <Wrench v-else :size="13" :stroke-width="1.8" aria-hidden="true" />
      Fix failed build with agent
    </button>
  </div>
</template>
