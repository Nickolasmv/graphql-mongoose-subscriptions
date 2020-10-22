# graphql-mongoose-subscriptions

[![Dependabot badge](https://flat.badgen.net/Nickolasmv/graphql-mongoose-subscriptions?icon=dependabot)](https://dependabot.com/)
[![Build Status](https://travis-ci.org/Nickolasmv/graphql-mongoose-subscriptions.svg?branch=master)](https://travis-ci.org/Nickolasmv/graphql-mongoose-subscriptions)

This package implements the PubSubEngine Interface from the [graphql-subscriptions](https://github.com/apollographql/graphql-subscriptions) package and also the new AsyncIterator interface. 
It allows you to connect your subscriptions manager to a mongoose Pub Sub mechanism to support 
multiple subscription manager instances.

## Installation
At first, install the `graphql-mongoose-subscriptions` package: 
```
npm install graphql-mongoose-subscriptions
```

As the [graphql-subscriptions](https://github.com/apollographql/graphql-subscriptions) package is declared as a peer dependency, you might receive warning about an unmet peer dependency if it's not installed already by one of your other packages. In that case you also need to install it too:
```
npm install graphql-subscriptions
```
   
## Using as AsyncIterator

Define your GraphQL schema with a `Subscription` type:

```graphql
schema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}

type Subscription {
    somethingChanged: Result
}

type Result {
    id: String
}
```

Now, let's create a simple `MongoosePubSub` instance:

```javascript
import { MongoosePubSub } from 'graphql-mongoose-subscriptions';
const pubsub = new MongoosePubSub();
```

Now, implement your Subscriptions type resolver, using the `pubsub.asyncIterator` to map the event you need:

```javascript
const SOMETHING_CHANGED_TOPIC = 'something_changed';

export const resolvers = {
  Subscription: {
    somethingChanged: {
      subscribe: () => pubsub.asyncIterator(SOMETHING_CHANGED_TOPIC),
    },
  },
}
```

> Subscriptions resolvers are not a function, but an object with `subscribe` method, that returns `AsyncIterable`.

Calling the method `asyncIterator` of the `MongoosePubSub` instance will send mongoose a `SUBSCRIBE` message to the topic provided and will return an `AsyncIterator` binded to the MongoosePubSub instance and listens to any event published on that topic.
Now, the GraphQL engine knows that `somethingChanged` is a subscription, and every time we will use `pubsub.publish` over this topic, the `MongoosePubSub` will `PUBLISH` the event over mongoose to all other subscribed instances and those in their turn will emit the event to GraphQL using the `next` callback given by the GraphQL engine.

```js
pubsub.publish(SOMETHING_CHANGED_TOPIC, { somethingChanged: { id: "123" }});
```

## Dynamically create a topic based on subscription args passed on the query

```javascript
export const resolvers = {
  Subscription: {
    somethingChanged: {
      subscribe: (_, args) => pubsub.asyncIterator(`${SOMETHING_CHANGED_TOPIC}.${args.relevantId}`),
    },
  },
}
```

## Using a pattern on subscription

```javascript
export const resolvers = {
  Subscription: {
    somethingChanged: {
      subscribe: (_, args) => pubsub.asyncIterator(`${SOMETHING_CHANGED_TOPIC}.${args.relevantId}.*`, { pattern: true })
    },
  },
}
```

## Using both arguments and payload to filter events

```javascript
import { withFilter } from 'graphql-subscriptions';

export const resolvers = {
  Subscription: {
    somethingChanged: {
      subscribe: withFilter(
        (_, args) => pubsub.asyncIterator(`${SOMETHING_CHANGED_TOPIC}.${args.relevantId}`),
        (payload, variables) => payload.somethingChanged.id === variables.relevantId,
      ),
    },
  },
}
```

## Creating the mongoose Client

The basic usage is great for development and you will be able to connect to a mongoose server running on your system seamlessly. For production usage, it is recommended to send a mongoose client from the using code and pass in any options you would like to use. e.g: Connection retry strategy.

```javascript
import { MongoosePubSub } from 'graphql-mongoose-subscriptions';
import mongoose from 'mongoose'; 

const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/test', {useNewUrlParser: true, useUnifiedTopology: true});
const pubsub = new MongoosePubSub();
```

```OR
const pubsub = new MongoosePubSub({mongooseOptions:{url:'mongodb://localhost:27017/test',options:{useNewUrlParser: true, useUnifiedTopology: true}}})
```

