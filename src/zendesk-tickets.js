/**
 * A library of utilities for working with Zendesk's REST API
 */
var request = require('request');

module.exports = function(options, logger) {
  var webhookName = options.name;

  function logPrefix() {
    return new Date().toLocaleString() + ': ' + webhookName + ': ';
  }

  /**
   * A utility that loads the User Object for a single user,
   * and makes sure that user is registered on zendesk.
   */
  function registerUser(userId, callback) {
    fetchZendeskUser(userId, function(err, zendeskUser) {
      if (err || zendeskUser) {
        callback(err, zendeskUser);
      } else {
        options.identities(userId, function(err, user) {
          if (err) {
            console.error(logPrefix() + 'identities function failed for ' + userId, err);
            callback(err);
          } else {
            var requestParams = getRequestObj('users/create_or_update.json', 'POST', {
              user: {
                external_id: userId,
                name: user.name,
                email: user.email
              }
            });

            request(requestParams, function(err, res, body) {
              if (err) {
                console.error(logPrefix() + 'create_or_update User failed for ' + userId, err);
              }
              callback(err, body.user);
            });
          }
        });
      }
    });
  }

  /**
   * Fetch the zendesk user using its Layer User Id
   */
  function fetchZendeskUser(userId, callback) {
    var requestParams = getRequestObj('users/show_many.json?external_ids=' + userId, 'GET');
    request(requestParams, function(err, res, body) {
      if (err) {
        console.error(logPrefix() + 'fetchZendeskUser request failed for ' + userId, err);
        callback(err);
      } else {
        callback(null, body.users[0]);
      }
    });
  }

  /**
   * Creates a Zendesk ticket from the first message in a conversation.
   */
  function createTicket(message, conversation, callback) {
    registerUser(message.sender.user_id, function(err, zendeskUser) {
      // Get the full text of the comment
      var fullText = message.parts.filter(function(part) {
        return part.mime_type === 'text/plain';
      }).map(function(part) {
        return part.body;
      }).join('\n');

      // Get the title for the ticket
      var text = message.parts.filter(function(part) {
        return part.mime_type === 'text/plain';
      })[0].body;
      if (text.length > 60) {
        text = text.replace(/([.;?])\s.*/, '$1');
        if (text.length > 60) {
          text = text.substring(0, 57) + '...';
        }
      }

      // Run the request
      logger('Creating Zendesk Ticket: ' + text + ' from ' + zendeskUser.name);
      var requestParams = getRequestObj('tickets.json', 'POST', {
        ticket: {
          requester_id: zendeskUser.id,
          external_id: conversation.id,
          subject: text,
          comment: {
            public: true,
            body: fullText
          },
          tags: ['layer-conversation'] // TODO: Should probably make this configurable
        }
      });
      request(requestParams, function(err, res, body) {
        if (err) {
          console.error(logPrefix() + 'Create Zendesk Ticket Failed: ', err);
          callback(err);
        } else if (body.error) {
          console.error(logPrefix() + 'Create Zendesk Ticket Failed: ', body.error);
          callback(new Error(body.error));
        } else {
          callback(null, body.ticket);
        }
      });
    });
  }

  /**
   * Create a comment from a Layer Message
   */
  function createComment(ticket, message, done) {
    // Get the zendesk ID for the user that sent the message
    registerUser(message.sender.user_id, function(err, zendeskUser) {
      if (err) {
        console.error(logPrefix() + 'Create Zendesk Comment Failed; unable to regiter/fetch zendesk user: ', err);
        return done(err);
      }

      // Get the text of the message
      var fullText = message.parts.filter(function(part) {
        return part.mime_type === 'text/plain';
      }).map(function(part) {
        return part.body;
      }).join('\n');

      var requestParams = getRequestObj('tickets/' + ticket.id + '.json', 'PUT', {
        ticket: {
          comment: {
            public: true,
            body: fullText,
            author_id: zendeskUser.id
          }
        }
      });

      request(requestParams, function(err, res, body) {
        if (err) {
          console.error(logPrefix() + 'Failed to create Zendesk Comment: ', err);
        } else {
          logger('Created Zendesk Comment for ticket ' + ticket.id);
        }
        done(err)
      });
    });
  }


  /**
   * Fetch a Zendesk ticket by ID from Zendesk's servers
   */
  function fetchZendeskTicket(ticketId, callback) {
    var requestParams = getRequestObj('tickets/' + ticketId + '.json', 'GET');
    request(requestParams, function(err, res, body) {
      if (err) {
        console.error(logPrefix() + 'Failed to retrieve Zendesk Comment: ', err);
        callback(err);
      } else {
        callback(null, body.ticket)
      }
    });
  }

  /**
   * Fetch a Zendesk ticket by ID from Zendesk's servers
   */
  function fetchTicketForConversation(conversationId, callback) {
    var requestParams = getRequestObj('tickets.json?external_id=' + conversationId, 'GET');
    request(requestParams, function(err, res, body) {
      if (err) {
        console.error(logPrefix() + 'Failed to retrieve Zendesk Comment: ', err);
        callback(err);
      } else {
        callback(null, body.tickets[0])
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

  return {
    createTicket: createTicket,
    createComment: createComment,
    fetchTicketForConversation: fetchTicketForConversation
  };
}
