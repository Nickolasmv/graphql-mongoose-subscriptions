/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
'use strict';

const mongoose = require('mongoose');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const MessageSchema = new mongoose.Schema({
  channel: String,
  createdAt: { type: Date, expires: 3600, default: Date.now },
  message: mongoose.Schema.Types.Mixed,
}, {
  capped: {
    size: 1024 * 16 * 25, // in bytes
    autoIndexId: true
  }
});

const Message = mongoose.models['PubSubMessage'] || mongoose.model('PubSubMessage', MessageSchema);

function Messenger(options){
  EventEmitter.apply(this, arguments);
  var o = options || {};
  if (o.mongooseOptions) {
    this.mongooseOptions = o.mongooseOptions;
  }
  this.subscribed = {};
  this.lastMessageTimestamp = null;
  this.startingMessageTimestamp = new Date();
  this.retryInterval = o.retryInterval || 100;
}

util.inherits(Messenger, EventEmitter);

Messenger.prototype.send = function (channel, msg, callback){
  var cb = function noop(){};
  if(typeof callback === 'function'){
    cb = callback;
  }
  var message = new Message({
    channel: channel,
    message: msg
  });
  message.save(cb);
};

Messenger.prototype.connect = function (callback) {
  var self = this;
  if (mongoose.connection.readyState == 0 && self.mongooseOptions ) {
    mongoose.connect(self.mongooseOptions.url,self.mongooseOptions.options)
  }
  var stream = Message.watch();// .on('change', change => console.log(change));

  stream.on('change', function data(doc) {
    const { fullDocument } = doc;
    self.lastMessageTimestamp = fullDocument.createdAt;
    if(self.subscribed[fullDocument.channel]){
      self.emit(fullDocument.channel, fullDocument.message);
    } 
  });

  // reconnect on error
  stream.on('error', function streamError(){
    stream.destroy();
    self.connect();
  });

  stream.on('close', function streamError() {
    stream.destroy();
    self.connect();
  });

  if(callback) callback();
};

Messenger.prototype.subscribe = function (channel, bool) {
  var self = this;
  if(channel && bool){
    self.subscribed[channel] = bool;
    return;
  }
  if(channel && self.subscribed[channel]){
    delete self.subscribed[channel];
  }
};

module.exports = Messenger;