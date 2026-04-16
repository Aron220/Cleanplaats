import '../styles/content.css';

export default defineContentScript({
  matches: [
    '*://*.marktplaats.nl/*',
    '*://*.2dehands.be/*',
    '*://*.2ememain.be/*',
  ],
  runAt: 'document_end',
  main() {
    console.log('Cleanplaats: main content script bootstrap loaded');
  },
});
