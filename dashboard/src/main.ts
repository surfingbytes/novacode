// node_modules
import { createApp } from 'vue';
import { createPinia } from 'pinia';

// components
import App from '@/App.vue';

// classes
import router from '@/classes/router';
import { applyActiveTheme } from '@/lib/themes';

import '@/assets/css/main.css';

// Apply stored theme before first paint of the Vue tree
applyActiveTheme();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
