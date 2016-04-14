/**
 * Setup the Zendesk Webhooks, which consists of
 * 1. Setting up the Zendesk Trigger
 * 2. Setting up the Zendesk Target
 *
 * Actual processing of event from Zendesk is done in index.js
 */

var request = require('request');

module.exports = function(options) {
  var webhookName = options.name;

  /**
   * See if the layer-zendesk trigger exists, and if not create it.
   */
  function setupTrigger(target, callback) {
    getTrigger(target, function(err, trigger) {
      if (err) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to fetch Zendesk Target! Please fix and retry!', err);
        callback(err);
      } else if (trigger) {
        callback(null, trigger);
      } else {
        createTrigger(target, callback);
      }
    });
  }

  /**
   * See if the layer-zendesk trigger exists
   */
  function getTrigger(target, callback) {
    // Create a zendesk target
    var requestParams = getRequestObj('triggers.json', 'GET');
    request(requestParams, function(err, res) {
      if (err) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to Get Zendesk Targets! Please fix and retry!', err);
        callback(err);
      }

      var matches = res.body.triggers.filter(function(trigger) {
        return trigger.actions.filter(function(action) {
          return action.field === 'notification_target' && action.value[0] === target.id;
        }).length;
      });
      callback(null, matches[0]);
    });
  }

  /**
   * Create the layer-zendesk trigger
   */
  function createTrigger(target, callback) {
    // Create a zendesk trigger
    var requestParams = getRequestObj('triggers.json', 'POST', {
      trigger: {
        title: 'Zendesk to Layer Hook',
        all: [{
          "field": "update_type",
          "operator": "is",
          "value": "Change"
        }, {
          "field": "current_tags",
          "operator": "includes",
          "value": "layer-conversation"
        }, {
          "field": "comment_is_public",
          "operator": "is",
          "value": "true"
        }, {
          "field": "current_via_id",
          "operator": "is_not",
          "value": 5
        }],
        actions: [{
          "field": "notification_target",
          "value": [target.id, "{\n    \"id\": \"{{ticket.id}}\",\n    \"external_id\": \"{{ticket.external_id}}\",\n    \"sender\": \"{{current_user.name}}\",\n    \"comment\": \"{{ticket.latest_public_comment}}\"\n}"]
        }]
      }
    });

    request(requestParams, function(err, res) {
      if (err || res.body.error) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to create Zendesk Trigger! Please fix and retry!', err || res.body.error);
        callback(err);
      } else {
        var triggerId = res.body.trigger.id;
        callback(null, res.body.trigger);
      }
    });
  }

  /**
   * See if the layer-zendesk target exists, and if not, create it.
   */
  function setupTarget(callback) {
    getTarget(function(err, target) {
      if (err) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to fetch Zendesk Target! Please fix and retry!', err);
        callback(err);
      } else if (target) {
        callback(null, target);
      } else {
        createTarget(callback);
      }
    });
  }

  /**
   * Figure out what URL to tell zendesk to send events to.
   * If using zPort it gets a bit messier; else just add
   * the path to our url.
   */
  function getTargetUrl() {
    var url = options.server.url;
    if (options.server.zPort) {
      url = url.replace(/^https\:/, 'http:');
      if (url.match(/\:(\d+)/)) {
        url = url.replace(/\:(\d+)/, ':' + options.server.zPort);
      } else {
        url += ':' + options.server.zPort;
      }
    }
    url += options.zendesk.path;
    return url;
  }

  /**
   * See if the layer-zendesk target exists
   */
  function getTarget(callback) {
    var url = getTargetUrl();

    // Create a zendesk target
    var requestParams = getRequestObj('targets.json', 'GET');
    request(requestParams, function(err, res) {
      if (err) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to Get Zendesk Targets! Please fix and retry!', err);
        callback(err);
      }
      var matches = res.body.targets.filter(function(target) {
        return target.title === 'Zendesk to Layer Hook' && target.target_url === url;
      });
      callback(null, matches[0]);
    });
  }

  /**
   * Create the layer-zendesk target
   */
  function createTarget(callback) {
    var url = getTargetUrl();
    // Create a zendesk target
    var requestParams = getRequestObj('targets.json', 'POST', {
      target: {
        type: 'url_target_v2',
        title: 'Zendesk to Layer Hook',
        content_type: 'application/json',
        target_url: url,
        method: 'post'
      }
    });
    request(requestParams, function(err, res) {
      if (err) {
        console.error(new Date().toLocaleString() + ': ' + webhookName + ': Failed to setup Zendesk Target! Please fix and retry!', err);
        callback(err);
      } else {
        var targetId = res.body.target.id;
        callback(null, res.body.target);
      }
    });
  }

  /**
   * Shared utility for setting up the request obj
   */
  function getRequestObj(endpoint, method, body) {
    var auth = '/token:' + options.zendesk.token;
    var authHeader = 'Basic ' + new Buffer(options.zendesk.username + auth).toString('base64');
    return {
      url: 'https://' + options.zendesk.subdomain + '.zendesk.com/api/v2/' + endpoint,
      headers: {
        'content-type': 'application/json',
        'authorization': authHeader
      },
      json: true,
      method: method,
      body: body
    };
  }

  /**
   * Put it all together in one simple function
   */
  return function(callback) {
    setupTarget(function(err, target) {
      if (err) {
        callback(err);
      } else {
        setupTrigger(target, function(err, trigger) {
          callback(err, trigger, target);
        });
      }
    });
  };
};
