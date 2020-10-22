/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
import { PubSub  } from"graphql-subscriptions"
import Messenger from "./messenger"

const defaultCommonMessageHandler = message => message;

export class MongodbPubSub extends PubSub  {
  constructor(options = {}) {
    const { commonMessageHandler } = options;
    super();
    this.ee = new Messenger(options);
    this.ee.connect();
    this.subscriptions = {};
    this.subIdCounter = 0;
    this.commonMessageHandler =
      commonMessageHandler || defaultCommonMessageHandler;
  }
   async publish(triggerName, payload) {
   this.ee.send(triggerName, payload);
   return  Promise.resolve(true);
  }
   async subscribe(triggerName, onMessage) {
      const callback = message => {
      onMessage(
        message instanceof Error
          ? message
          : this.commonMessageHandler(message)
      );
    };
    this.subIdCounter = this.subIdCounter + 1;
    this.subscriptions[this.subIdCounter] = [triggerName, callback];
    this.ee.subscribe(triggerName,true);
    this.ee.addListener(triggerName, callback);
    return Promise.resolve(this.subIdCounter);
  }
  unsubscribe(subId) {
    if (this.subscriptions[subId]) {
      const [triggerName, callback] = this.subscriptions[subId];
      delete this.subscriptions[subId];
      this.ee.removeListener(triggerName, callback);
      this.ee.subscribe(triggerName, false);
    }
  }
}
