export default defineContentScript({
  matches: [
    '*://*.marktplaats.nl/*',
    '*://*.2dehands.be/*',
    '*://*.2ememain.be/*',
  ],
  runAt: 'document_start',
  allFrames: true,
  main() {
    // Placeholder entrypoint; will be replaced by typed theme init logic.
  },
});
