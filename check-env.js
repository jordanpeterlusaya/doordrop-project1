const { config } = require('./backend/config');

console.log({
  places: !!config.googlePlacesApiKey,
  routes: !!config.googleRoutesApiKey,
  webhook: !!config.debugWebhookUrl,
  keyPreview: config.googlePlacesApiKey
    ? config.googlePlacesApiKey.slice(0, 8) + '...'
    : 'missing',
});
