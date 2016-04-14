var request = require('request');
var Debug = require('debug');

// Default parameter values
var DEFAULT_LAYER_PATH = '/zendesk-integration-event';
var DEFAULT_ZENDESK_PATH = '/zendesk-server-event';
var DEFAULT_NAME = 'Zendesk Integration'
var REDIS_PREFIX = 'layer-webhooks-zendesk-';

/**
 *
 *
 * @method
 * @param  {Object} options
 * @param {Function} [options.identities] - Lookup user information for Message sender
 * @param {string} options.identities.senderId - User ID of the Message sender to lookup.
 * @param {Function} options.identities.callback - Callback for getUser data
 * @param {Object} options.identities.callback.err - Error response for getUser call
 * @param {Object} options.identities.callback.user - Custom user object; should have name and email properties.
 * @param {string} options.name - Name of the integration; this will show up in Layer's list of webhooks and in Zendesk's lists of triggers and targets
 * @param {Object} options.layer - Set of layer-specific parameters
 * @param {string} [options.layer.path=/zendesk-integration-event] - Path to listen for Layer Webhooks
 * @param {string} options.layer.secret - Secret used to validate incoming webhook requests
 * @param  {Layer-API-Client} options.layer.client - instance of the `layer-api` npm module
 * @param  {Layer-Webhooks-Client} options.layer.webhooksServices - instance of the `layer-webhooks-services` npm module
 * @param {Object} options.zendesk - Set of zendesk specific parameters
 * @param {string} options.zendesk.user - UserID for your zendesk account
 * @param {string} options.zendesk.token - Zendesk API Token for your account.
 * @param {string} options.zendesk.subdomain - Subdomain for your zendesk account 'layer' for 'layer.zendesk.com'.
 * @param {string} [options.zendesk.path=/zendesk-new-messages] - Path to listen for Layer Webhooks
 * @param {Object} options.server - Set of server specific parameters
 * @param {string} options.server.url - Base URL for this webserver, needed to tell remote servers where to send webhook requests.
 *                               Will concatenate with path parameter.
 * @param {Express App} options.server.app - Express App running on https; port its listening on should be in the url parameter
 * @param {Express App} [options.server.zApp=app] - If using a self signed certificate, zendesk can't talk to your webhooks.  Provide a second express server that is on http rather than https.  This parameter is typically only needed for development, not for production.   Also note that the zendesk target will be registered with https and must be hand edited to http for this to work.
 * @param {number} [options.server.zPort] - Needed only if zApp is used.  zApp must be on a separate port from app.  Note that the url parameter uses app's port not zApp's port.
 * @param {Redis}  options.server.redis - An instance created from the redis npm module
 * @param {Function} [options.useConversation] - Return boolean true if the Conversation should get a zendesk ticket; false if not.  If function not provided, then all conversations get tickets.  This function
 *                                               is evaluated when the Conversation is created; changes to the Conversation do NOT cause this function to be reevaluated.
 * @param {Conversation} options.useConversation.conversation - Function takes a single Conversation object; look at its metadata or participants to decide whether to create a ticket.
 */
module.exports = function(options) {
  var redis = options.server.redis;
  var queue = require('kue').createQueue();
  var webhookName = options.name || DEFAULT_NAME;
  options.layer.path = options.layer.path || DEFAULT_LAYER_PATH;
  options.zendesk.path = options.zendesk.path || DEFAULT_ZENDESK_PATH;

  var logger = Debug('layer-webhooks-zendesk:' + webhookName);
  var zendeskHooks = require('./src/zendesk-hooks')(options);
  var zendeskTickets = require('./src/zendesk-tickets')(options, logger);
  if (!options.server.zApp) options.server.zApp = options.server.app;
  if (!options.identities) {
    options.identities = function(userId, callback) {
      options.layer.client.identities.get(userId, function(err, res) {
      	var result;
      	if (res) {
      	  result = {
      	    name: res.body.display_name,
      	    avatarUrl: res.body.avatar_url,
      	    firstName: res.body.first_name,
      	    lastName: res.body.last_name,
      	    email: res.body.email_address,
      	    phone: res.body.phone_number,
      	    metadata: res.body.metadata
      	  }
      	}
	     callback(err, result);
      });
    };
  }

  /**
   * Call this once while bringing up the server.
   * Setup the server to listen for incoming webhooks from Layer's servers, and make sure
   * we have registered our webhook endpoint with their servers.
   */
  function setupLayerWebhooks() {

    // Define the specialized receipts hook structure
    var hook = {
      name: webhookName,
      path: options.layer.path,

      // These events are needed for the register call
      events: ['message.sent', 'conversation.created']
    };

    // Register the webhook with Layer's Services
    options.layer.webhooksServices.register({
      secret: options.layer.secret,
      url: options.server.url,
      hooks: [hook]
    });

    // Listen for events from Layer's Services
    options.layer.webhooksServices.listen({
      expressApp: options.server.app,
      secret: options.layer.secret,
      hooks: [hook]
    });
  }


  /**
   * Call this once while bringing up the server.
   * Listen for incoming webhooks from the zendesk servers, and make sure
   * we have registered our webhook endpoint with their servers.
   */
  function setupZendeskWebhooks() {
    // Listen for zendesk webhooks, create a job so we can process them asynchronously
    options.server.zApp.post(options.zendesk.path, function(req, res) {
      queue.createJob(webhookName + ' new zendesk comment', req.body).attempts(10).backoff({
        type: 'exponential',
        delay: 10000
      }).save(function(err) {
        if (err) {
          console.error(new Date().toLocaleString() + ': ' + webhookName + ': Unable to create Kue process: ', err);
        }
      });
      res.sendStatus(200);
    });

    // Register a webhook with zendesk's servers
    zendeskHooks(function(err, trigger, target) {
      if (err) return console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to setup Zendesk Trigger! Please fix and retry!', err);
      logger('Server Setup: Zendesk Target ' + target.id + ' and Trigger ' + trigger.id + ' are ready');
    });
  }

  /**
   * Process zendesk webhook events.
   * Currently only expect webhooks when a new public message is posted on a Ticket that has the "layer-conversation" tag.
   */
  queue.process(webhookName + ' new zendesk comment', function(job, done) {
    logger('New Comment Received');
    var conversationId = job.data.external_id;
    options.layer.client.messages.sendTextFromName(conversationId, job.data.sender, job.data.comment, done);
  });

  /**
   * Process Layer webhook events.  Incoming hooks result in creating zendesk tickets or comments.
   *
   * Conversations are stored in redis on creation; this is a simple mechanism for declaring that this Conversation
   * has not yet had a ticket created, but needs a ticket when the first message is posted.
   * We can't create a ticket without the first message; its text is a requirement for the ticket.
   * When the first message comes, we remove the Conversation from redis.
   * This means that a conversation is stored only for the very brief time between creating a conversation and its first Message,
   * typically just miliseconds.
   * Why not store conversations in redis long term? A typical support ticket is a short term item of data, storing lots of temporary
   * conversations does not seem ideal.  Revisit as needed.  We could keep a ticket in memory until ticket is marked as closed.
   */
  queue.process(webhookName, function(job, done) {
    switch (job.data.type) {
      // Any new Conversation gets written to redis, and will stay there until its first message is posted.
      case 'conversation.created':
        handleNewConversationEvent(job.data.conversation, done);
        break;

        // Any new Message either creates a zendesk ticket (first message) or zendesk comment (subsequent message)
      case 'message.sent':
        handleMessageSentEvent(job.data.message, done);
        break;
    }
  });

  /**
   * If the Conversation is intended to be associated with a Zendesk ticket (see useConversation parameter)
   * then write the Conversation to redis.
   */
  function handleNewConversationEvent(conversation, done) {
    try {
      if (options.useConversation && !options.useConversation(conversation)) return done();
      redis.set(REDIS_PREFIX + conversation.id, JSON.stringify(conversation));
    } catch (err) {
      return done(err);
    }
    done();
  }


  /**
   * On receiving a "message.sent" event, we either need to create a ticket, create a comment, or do nothing.
   * If the Conversation is stored in redis, then the ticket has not yet been created... and a ticket is needed.
   * If the Conversation is NOT stored in redis, then either zendesk already has a ticket (in which case we create a comment),
   * or this Conversation does not relate to a zendesk ticket.
   */
  function handleMessageSentEvent(message, done) {
    redis.get(REDIS_PREFIX + message.conversation.id, function(err, conversation) {
      if (err) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to read Conversation from redis:', err);
        return done(err);
      }

      // The conversation is in redis; create the ticket
      if (conversation) {
        zendeskTickets.createTicket(message, JSON.parse(conversation), function(err, ticket) {
          if (!err) redis.del(REDIS_PREFIX + message.conversation.id);
          done(err);
        });
      }

      // The conversation is not in redis, see if we have a ticket
      else {
        // See if there is a ticket associated with this Conversation; if there isn't, no further action needed.
        zendeskTickets.fetchTicketForConversation(message.conversation.id, function(err, ticket) {
          if (err) {
            console.error(new Date().toLocaleString() + ': ' + webhookName + ': Fetch Ticket for Comment Failed:', err);
            return done(err);
          }
          if (ticket) {
            zendeskTickets.createComment(ticket, message, done);
          } else {
            done();
          }
        });
      }
    });
  }

  // Setup the servers and webhooks
  setupLayerWebhooks();
  setupZendeskWebhooks();
};
