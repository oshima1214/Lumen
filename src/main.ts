import { mount } from 'svelte';
import './ui/theme.css';
import App from './App.svelte';

export { APP_ID } from './app-id';

const target = document.getElementById('app');
if (target) mount(App, { target });
