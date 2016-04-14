# Examples

You can run this example as a standalone server with some configuration.

## Running on Heroku

1. Get the repo: `git clone git@github.com:layerhq/node-layer-webhooks-services-zendesk.git`
2. CD into folder: `cd node-layer-webhooks-services-zendesk`
3. Create Heroku App: `heroku create`
4. Deploy to Heroku: `git push heroku master`
5. Configure your:
  * Layer App ID: `heroku config:set LAYER_APP_ID=YOUR_APP_ID`
  * Layer Authentication Token: `heroku config:set LAYER_BEARER_TOKEN=YOUR_TOKEN`
  * Zendesk User name/email: `heroku config:set ZENDESK_USER=YOUR_USER`
  * Zendesk API Token: `heroku config:set ZENDESK_TOKEN=YOUR_TOKEN`
  * Zendesk Subdomain: `heroku config:set ZENDESK_SUBDOMAIN=YOUR_SUBDOMAIN_ON_ZENDESK`
  * Hostname: `heroku config:set HOST=$(heroku apps:info -s  | grep web-url | cut -d= -f2)`
  * Logger: `heroku config:set 'DEBUG=*,-body-parser:json, -express:*'`
6. Install `heroku-redis`: Instructions at https://devcenter.heroku.com/articles/heroku-redis#installing-the-cli-plugin

You should now be able to send messages, change conversation titles, and see the webhook examples respond.


## Running on Your Server

1. Get the repo: `git clone git@github.com:layerhq/node-layer-webhooks-services-zendesk.git`
2. CD into folder: `cd node-layer-webhooks-services-zendesk`
3. Install root dependencies: `npm install`
4. CD into the examples folder: `cd examples`
5. Install example dependencies `npm install`
6. Setup an `ssl` folder with your certificate; your ssl folder should have:
  * server.key
  * server.crt
  * ca.crt
7. Setup your .env file to have the following values:
  * `ZENDESK_USER`: Username/email for your zendesk admin account
  * `ZENDESK_TOKEN`: API Key for your zendesk account
  * `ZENDESK_SUBDOMAIN`: If your using mycompany123.zendesk.com, provide 'mycompany123'
  * `ZENDESK_PORT`: If running on a self signed certificate, you'll need a separate `ZENDESK_PORT` which is different from `WEBHOOK_PORT`.  Otherwise leave this out.
  * `HOST`: Your server host name or IP
  * `WEBHOOK_PORT`: The port your server will receive requests on (defaults to 443 if unset)
  * `LAYER_BEARER_TOKEN`: You can find your Bearer Token on Layer's Developer Dashboard, in the `keys` section.
  * `LAYER_APP_ID`: Your layer app id; you can find this on the same page as your bearer token
  * `REDIS_URL`: Only needed if your not running redis locally.
8. Run the server: `npm start`
