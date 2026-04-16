import '../styles/content.css';
import { initCleanplaats } from '@/content/bootstrap';

export default defineContentScript({
  matches: ['*://*.marktplaats.nl/*', '*://*.2dehands.be/*', '*://*.2ememain.be/*'],
  runAt: 'document_end',
  cssInjectionMode: 'manifest',
  main() {
    const start = (): void => {
      void initCleanplaats();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  },
});
