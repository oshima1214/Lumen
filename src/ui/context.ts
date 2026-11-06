// コンポーネントへ App を渡す context
import { getContext, setContext } from 'svelte';
import type { App } from './app.svelte';

const KEY = Symbol('lumen-app');

export function provideApp(app: App): void { setContext(KEY, app); }

export function useApp(): App {
  const app = getContext<App | undefined>(KEY);
  if (!app) throw new Error('App が context にありません');
  return app;
}
