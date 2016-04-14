// Setup the express server
require('dotenv').load();

var https = require('https');
var fs = require('fs');

var express = require('express');
var bodyParser = require('body-parser');

var layerZendesk = require('../index');

var app = express();
app.use(bodyParser.json({type: '*/*'}));
if (process.env.ZENDESK_PORT) {
  var zApp = express();
  zApp.use(bodyParser.json({type: '*/*'}));
}

// Setup environmental variables
if (!process.env.LAYER_BEARER_TOKEN) return console.error('LAYER_BEARER_TOKEN missing in your environmental variables');
if (!process.env.LAYER_APP_ID) return console.error('LAYER_APP_ID missing in your environmental variables');
var PORT = process.env.WEBHOOK_PORT || '443';
var HOST = process.env.HOST || 'localhost';
var URL  = ((HOST.indexOf('https://') === 0) ? HOST : 'https://' + HOST).replace(/\/$/, '') + ':' + PORT;

// Setup Redis and kue
var redis = require('redis').createClient(process.env.REDIS_URL);
var queue = require('kue').createQueue({
  jobEvents: false,
  redis: process.env.REDIS_URL
});

// Setup the Layer Webhooks Service
var LayerWebhooks = require('layer-webhooks-services');
var webhooksServices = new LayerWebhooks({
  token: process.env.LAYER_BEARER_TOKEN,
  appId: process.env.LAYER_APP_ID,
  redis: redis
});

// Setup the Layer Platform API
var LayerClient = require('layer-api');
var layerClient = new LayerClient({
  token: process.env.LAYER_BEARER_TOKEN,
  appId: process.env.LAYER_APP_ID,
});

// Presumably you either have the ssl folder setup... or your running on
// heroku where its not required, and we can just use the app variable.
var key, cert, ca, secureServer;
try {
  key = fs.readFileSync('./ssl/server.key');
  cert= fs.readFileSync('./ssl/server.crt');
  ca  = fs.readFileSync('./ssl/ca.crt');
  secureServer = https.createServer({
    key: key,
    cert: cert,
    ca: ca,
    requestCert: true,
    rejectUnauthorized: false
  }, app);
} catch(e) {
  console.log('NOTE: No SSL folder, assuming this is heroku environment');
  secureServer = app;
}

// Startup the server; allow for a custom heroku PORT
secureServer.listen(process.env.PORT || PORT, function() {
  console.log('Secure Express server listening on port ' + (process.env.PORT || PORT));

  if (zApp) {
    zApp.listen(process.env.ZENDESK_PORT, function() {
      console.log("Zendesk App Server listening on " + process.env.ZENDESK_PORT);
      init();
    });
  } else {
    init();
  }
});

// TODO: Configure an automated response when a ticket is created?
// TODO: Allow to configure zendesk-hooks listening endpoint
function init() {
 layerZendesk({
   name:  'Zendesk Layer Integration',
   layer: {
     webhooksServices: webhooksServices,
     client: layerClient,
     secret: 'Lord of the Mog has jammed your radar'
   },
   zendesk: {
     username: process.env.ZENDESK_USER,
     token: process.env.ZENDESK_TOKEN,
     subdomain: process.env.ZENDESK_SUBDOMAIN
   },
   server: {
     url: URL,
     app: app,
     zApp: zApp, // If zApp not provided, will use app to listen for zendesk webhooks.  Also note that the zendesk target will be registered with https and must be hand edited to http
     zPort: zApp ? process.env.ZENDESK_PORT : null, // Will use the port in your URL if not provided
     redis: redis
   }
  });
}
