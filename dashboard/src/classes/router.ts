// node_modules
import { createRouter, createWebHistory } from 'vue-router';

// stores
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: (): Promise<typeof import('@/views/LoginView.vue')> =>
        import('@/views/LoginView.vue'),
      meta: { public: true }
    },
    {
      path: '/setup',
      name: 'setup',
      component: (): Promise<typeof import('@/views/SetupView.vue')> =>
        import('@/views/SetupView.vue'),
      meta: { public: true }
    },
    {
      path: '/',
      name: 'home',
      component: (): Promise<typeof import('@/views/HomeView.vue')> => import('@/views/HomeView.vue')
    },
    {
      path: '/workspaces',
      name: 'workspaces',
      component: (): Promise<typeof import('@/views/workspace/ListView.vue')> =>
        import('@/views/workspace/ListView.vue')
    },
    {
      path: '/workspace/:id',
      name: 'workspace',
      component: (): Promise<typeof import('@/views/workspace/DetailView.vue')> =>
        import('@/views/workspace/DetailView.vue'),
      children: [
        {
          path: '',
          name: 'workspace-sessions',
          component: (): Promise<typeof import('@/views/workspace/detail/SessionView.vue')> =>
            import('@/views/workspace/detail/SessionView.vue')
        },
        {
          path: 'files',
          name: 'workspace-files',
          component: (): Promise<typeof import('@/views/workspace/detail/FilesView.vue')> =>
            import('@/views/workspace/detail/FilesView.vue')
        },
        {
          path: 'git',
          name: 'workspace-git',
          component: (): Promise<typeof import('@/views/workspace/detail/GitView.vue')> =>
            import('@/views/workspace/detail/GitView.vue')
        },
        {
          path: 'rules',
          name: 'workspace-rules',
          component: (): Promise<typeof import('@/views/workspace/detail/RulesView.vue')> =>
            import('@/views/workspace/detail/RulesView.vue')
        }
      ]
    },

    {
      path: '/workspace/:id/session/:sessionId',
      name: 'session',
      component: (): Promise<typeof import('@/views/SessionView.vue')> =>
        import('@/views/SessionView.vue')
    },
    {
      path: '/workspace/:id/orchestrator/:orchestratorId',
      name: 'orchestrator',
      component: (): Promise<typeof import('@/views/SessionView.vue')> =>
        import('@/views/SessionView.vue')
    },
    {
      path: '/automations',
      name: 'automations',
      component: (): Promise<typeof import('@/views/AutomationsView.vue')> =>
        import('@/views/AutomationsView.vue')
    },
    {
      path: '/role-templates',
      name: 'role-templates',
      component: (): Promise<typeof import('@/views/RoleTemplatesView.vue')> =>
        import('@/views/RoleTemplatesView.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: (): Promise<typeof import('@/views/SettingsView.vue')> =>
        import('@/views/SettingsView.vue')
    },
    {
      path: '/account',
      name: 'account',
      component: (): Promise<typeof import('@/views/AccountView.vue')> =>
        import('@/views/AccountView.vue')
    }
  ]
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    return true;
  }
  if (!auth.token) {
    return { name: 'login' };
  }
  if (!auth.bValidated) {
    const ok = await auth.validate();
    if (!ok) {
      return { name: 'login' };
    }
  }
  return true;
});

export default router;
