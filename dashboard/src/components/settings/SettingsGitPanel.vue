<script setup lang="ts">
// node_modules
import { ref, computed, onMounted } from 'vue';

// classes
import { settingsApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';

// components
import SettingsForgeSection from '@/components/settings/SettingsForgeSection.vue';

// composables
import { useInlineFieldErrors } from '@/composables/useInlineFieldErrors';

// stores
import { useToastStore } from '@/stores/toasts';

// utils
import { optionalEmailError } from '@/utils/formValidation';

// -------------------------------------------------- Refs --------------------------------------------------
const gitForm = ref<{ name: string; email: string }>({ name: '', email: '' });
// Last loaded/saved values; the form is dirty when it differs from these.
const gitBaseline = ref<{ name: string; email: string }>({ name: '', email: '' });
const bSavingGit = ref<boolean>(false);
const bGitSaved = ref<boolean>(false);
const sshPublicKey = ref<string>('');
const sshPrivateKey = ref<string>('');
const bCopiedSshPublic = ref<boolean>(false);
const bCopiedSshPrivate = ref<boolean>(false);

const { errors, touch, onInput, validateAll } = useInlineFieldErrors({
  email: () => optionalEmailError(gitForm.value.email)
});

const toastStore = useToastStore();

// -------------------------------------------------- Computed --------------------------------------------------
const hasUnsavedChanges = computed<boolean>(
  () =>
    gitForm.value.name !== gitBaseline.value.name ||
    gitForm.value.email !== gitBaseline.value.email
);

// -------------------------------------------------- Methods --------------------------------------------------
const loadSettings = async (): Promise<void> => {
  try {
    const response = await settingsApi.get();
    gitForm.value.name = response.data.gitUserName ?? '';
    gitForm.value.email = response.data.gitUserEmail ?? '';
    gitBaseline.value = { ...gitForm.value };
    sshPublicKey.value = response.data.sshPublicKey ?? '';
    sshPrivateKey.value = response.data.sshPrivateKey ?? '';
  } catch {
    // ignore
  }
};

/** Copies text, toasting when the Clipboard API is missing (plain-http deployments) or rejects. */
const copyToClipboard = async (text: string, label: string): Promise<boolean> => {
  if (!navigator.clipboard) {
    toastStore.error(`Clipboard unavailable — copy the ${label} manually (requires HTTPS)`);
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toastStore.error(`Failed to copy the ${label}`);
    return false;
  }
};

const copySshPublic = async (): Promise<void> => {
  if (!sshPublicKey.value) {
    return;
  }
  if (!(await copyToClipboard(sshPublicKey.value, 'public key'))) {
    return;
  }
  bCopiedSshPublic.value = true;
  setTimeout(() => {
    bCopiedSshPublic.value = false;
  }, 2000);
};

const copySshPrivate = async (): Promise<void> => {
  if (!sshPrivateKey.value) {
    return;
  }
  if (!(await copyToClipboard(sshPrivateKey.value, 'private key'))) {
    return;
  }
  bCopiedSshPrivate.value = true;
  setTimeout(() => {
    bCopiedSshPrivate.value = false;
  }, 2000);
};

const saveGitSettings = async (): Promise<void> => {
  if (!validateAll()) {
    return;
  }
  bSavingGit.value = true;
  bGitSaved.value = false;
  const submitted = { ...gitForm.value };
  const saved = { name: submitted.name.trim(), email: submitted.email.trim() };
  try {
    const response = await settingsApi.update({
      gitUserName: saved.name || null,
      gitUserEmail: saved.email || null
    });
    sshPublicKey.value = response.data.sshPublicKey ?? '';
    sshPrivateKey.value = response.data.sshPrivateKey ?? '';
    // Keep edits typed while the request was in flight.
    if (gitForm.value.name === submitted.name && gitForm.value.email === submitted.email) {
      gitForm.value = { ...saved };
    }
    gitBaseline.value = saved;
    toastStore.success('Git identity saved');
    bGitSaved.value = true;
    setTimeout(() => {
      bGitSaved.value = false;
    }, 2000);
  } catch (err) {
    notifyApiError(err, 'Failed to save git identity');
  } finally {
    bSavingGit.value = false;
  }
};

onMounted((): void => {
  void loadSettings();
});

defineExpose({ hasUnsavedChanges });
</script>

<template>
  <div role="tabpanel">
        <div>
          <div class="settings-section-label nc-eyebrow">Git Identity</div>
          <p class="settings-section-desc">
            Global git user name and email. Individual workspaces can override these.
            Automatic commit messages use the Background AI agent and model on the General tab.
          </p>
          <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5 space-y-4">
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1.5">Name</label>
              <input
                v-model="gitForm.name"
                type="text"
                placeholder="Your Name"
                class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1.5">Email</label>
              <input
                v-model="gitForm.email"
                type="email"
                placeholder="you@example.com"
                class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                :aria-invalid="Boolean(errors.email)"
                aria-describedby="settings-git-email-error"
                @blur="touch('email')"
                @input="onInput('email')"
              />
              <p v-if="errors.email" id="settings-git-email-error" class="text-xs text-destructive mt-1.5">
                {{ errors.email }}
              </p>
            </div>
            <div class="flex items-center gap-3 pt-1">
              <button
                class="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                :disabled="bSavingGit || Boolean(errors.email)"
                @click="saveGitSettings"
              >
                <div
                  v-if="bSavingGit"
                  class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
                ></div>
                Save
              </button>
              <span v-if="bGitSaved" class="text-xs text-success">Saved.</span>
            </div>
          </div>
        </div>

        <!-- SSH key (Docker / server identity for git push) -->
        <div style="margin-top: 36px;">
          <div class="settings-section-label nc-eyebrow">SSH key for Git remotes</div>
          <p class="settings-section-desc">
            On first startup the server creates an ed25519 keypair under your config volume (
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >.ssh/id_ed25519</code
            >
            ). Add the <strong class="text-text-primary font-medium">public</strong> key to your
            Git host (GitHub, GitLab, Gitea, etc.) so
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded font-mono text-[11px]"
              >git push</code
            >
            over SSH works from the container. The private key is shown only here — protect it like
            any deploy key.
          </p>
          <div class="space-y-4">
            <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
              <div class="flex items-center justify-between gap-2 mb-2">
                <label class="text-sm font-medium text-text-primary">Public key</label>
                <button
                  type="button"
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-fg/[0.12] bg-fg/[0.05] hover:bg-fg/[0.09] text-text-primary transition-colors disabled:opacity-40"
                  :disabled="!sshPublicKey"
                  @click="copySshPublic"
                >
                  {{ bCopiedSshPublic ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <pre
                class="text-xs font-mono text-text-muted whitespace-pre-wrap break-all bg-fg/[0.05] border border-fg/[0.08] rounded-lg px-3 py-2.5 min-h-[2.5rem]"
                >{{ sshPublicKey || '—' }}</pre
              >
            </div>
            <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
              <div class="flex items-center justify-between gap-2 mb-2">
                <label class="text-sm font-medium text-text-primary">Private key</label>
                <button
                  type="button"
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-fg/[0.12] bg-fg/[0.05] hover:bg-fg/[0.09] text-text-primary transition-colors disabled:opacity-40"
                  :disabled="!sshPrivateKey"
                  @click="copySshPrivate"
                >
                  {{ bCopiedSshPrivate ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <pre
                class="text-xs font-mono text-text-muted whitespace-pre-wrap break-all bg-fg/[0.05] border border-fg/[0.08] rounded-lg px-3 py-2.5 min-h-[2.5rem] max-h-48 overflow-y-auto"
                >{{ sshPrivateKey || '—' }}</pre
              >
              <p class="text-xs text-warning mt-2">
                Anyone with this key can push as you to any host that trusts the public key. Do not
                share it.
              </p>
            </div>
          </div>
        </div>

        <SettingsForgeSection />
  </div>
</template>
