# Layer Webhooks Service - Zendesk

This repository contains a two way integration between [Layer's Messaging Service](https://layer.com) and [Zendesk's ticketing system](https://www.zendesk.com/).

* Every new Layer conversation will create a corresponding Zendesk ticket
* Every new Layer message within the conversation will be posted as a comment in the Zendesk ticket
* Every comment posted in the Zendesk ticket will be posted into the Layer conversation as a message
* All participants in the Layer conversation will be registered as Zendesk users so that we can show their information in the comments

It utilizes a set of APIs:

* [Layer Webhooks API](https://developer.layer.com/docs/webhooks)
* [Layer Platform API](https://developer.layer.com/docs/platform)
* [Zendesk API](https://developer.zendesk.com/rest_api/docs/core/introduction)

## Warnings

Zendesk API will not work if you are using self signed SSL certificates on your `HTTPS` server. It will work using `HTTP` though.
Layer Webhooks on the other hand refuse to talk to `HTTP` servers, but will work with `HTTPS` using a self signed certificate.

If testing with self signed certificate, you must setup two express servers, one listening for Layer Webhooks on `HTTPS` and one that listens for Zendesk webhooks on `HTTP`; this setup is illustrated in the examples folder.

A Ticket is not created until the First Message is sent within that new Conversation; a new Conversation alone does not create a ticket.

## layerZendesk(options)

Layer Zendesk service gets initialized using the following options:

- `name` - A name for this zendesk integration
- `layer.webhooksServices` - A [Layer Webhooks Services](https://github.com/layerhq/node-layer-webhooks-services) instance
- `layer.client` - A [Layer Platform API](https://github.com/layerhq/node-layer-api) client instance
- `layer.secret` - An arbitrary string you provide used to validate the webhooks events
- `layer.path` - URL path on which to listen for Layer Webhooks
- `zendesk.username` - Your Zendesk username
- `zendesk.token` - A Zendesk API token
- `zendesk.subdomain` - Subdomain that hosts your Zendesk site
- `zendesk.path` - URL path on which to listen for Zendesk Webhooks
- `server.url` - Base URL that webhook requests will be sent from both Layer and Zendesk; paths will be appended to this.
- `server.app` - Express app instance
- `server.zApp` - Secondary Express app instance (Optional)
- `server.zPort` - Custom port for zApp (Optional)
- `server.redis` - Redis client instance
- `identities` - A function that returns user information in a callback
- `useConversation` - A function that allows you to identify Zendesk-relevant Conversations by returning a boolean

### name

Assign a name for this Layer Zendesk integration. This name will appear in your

* Zendesk Target
* Zendesk Trigger
* Layer Webhook

A suitable default name is provided; but if setting up multiple servers connected to a single app id or zendesk account, a unique name is needed.

### layer.webhooksServices

Provide an instance of the `layer-webhooks-services` npm module, instantiated with your app ID
and token.

### layer.client

Provide an instance of the `layer-api` npm module, instantiated with your app ID and token.

### layer.secret

An arbitrary string you provide; used to validate that events received by your server come from Layer's Servers, and not some unknown source.

### layer.path

URL path on which to listen for Layer Webhooks.  Suitable default is provided; customize if needed.

### zendesk.username

Your username on zendesk

### zendesk.token

Zendesk API token to authenticate your requests to zendesk's APIs.

### zendesk.subdomain

The subdomain that hosts your zendesk site.  If you are on 'https://mycompany.zendesk.com', then use the value 'mycompany'.

### zendesk.path

URL path on which to listen for Zendesk Webhooks.  Suitable defaults are provided.

### server.url

The base URL that webhook requests will be sent to from both Layer and Zendesk. `zendesk.path` and `layer.path` are appended to this for listening to each type of webhook.

### server.app

An express app. Must be able to receive `https` requests.  This app will be used to listen
to webhook requests.

### server.zApp

This is for developers working in dev environment with self signed certificates.

Zendesk's servers will not talk to a self signed certificate.  Which means you must provide a Second express server listening on another port and accepting `http` requests.

If this parmeter is omitted, the `server.app` parameter will be used in its place.


### server.zPort

If you are using `server.zApp`, it must be listening on a different port from the main server. Provide the port number so that Zendesk's webhooks can be correctly setup to talk to this port.

### server.redis

Provide an instantiated object from the `redis` npm module.

### identities(userId, callback)

Layer's Webhooks provide a userId for the sender of a Message, but does NOT provide a displayable name for that user, nor an email, both of which are needed for the sender's Message to correctly render as a Zendesk comment.

If you are using Layer's Identity Services and registering an email address as part of your user's Identity through that service, then you can ommit the identities parameter.  Otherwise, you will need to provide this function to get a name and email for the user.

`identities` should return a User Object.  Your User Object must provide `name` and `email` fields.

```javascript
function myGetIdentity(userId, callback) {
  // Lookup in a database or query a web service to get details of this user
  doLookup(userId, function(err, user) {
    callback(err, {
      email: user.email,
      name: user.displayName
    });
  });
}
layerZendesk({
  identities: myGetIdentity,
  ...
});
```

### useConversation(conversation)

There may be some Conversations created within your app that are intended to be linked to zendesk tickets, and some that are not.

* If ALL Conversations should be zendesk tickets, then omit the useConversation parameter
* Return true for Conversations that should become Zendesk tickets
* Return false for Conversations that should NOT become Zendesk tickets
* Note that any decision is based on metadata and participants at the time of the Conversation creation, and is not reevaluated later on.

```javascript
function useConversation(conversation) {
  return conversation.metadata && conversation.metadata.isTicket;
}
layerZendesk({
  useConversation: useConversation,
  ...
});
```

## Example

```javascript
// Setup express
var app = express();

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

// Setup Layer Zendesk service
var layerZendesk = require('layer-webhooks-services-zendesk');
layerZendesk({
  name:  'Zendesk Layer Integration',
  layer: {
    webhooksServices: webhooksServices,
    client: layerClient,
    secret: 'Lord of the Mog has jammed your radar'
  },
  zendesk: {
    username: 'helpdesk@layer.com',
    token: 'My Token',
    subdomain: 'mycompany123'
  },
  server: {
    url: 'https://webhooks.mycompany.com',
    app: app,
    redis: redis
  }
});
```
