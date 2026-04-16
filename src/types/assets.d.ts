declare module '*.css';

/** Allow bundled asset paths (icons, etc.) with `browser.runtime.getURL`. */
declare module 'wxt/browser' {
  export interface WxtRuntime {
    getURL(path: string): string;
  }
}
