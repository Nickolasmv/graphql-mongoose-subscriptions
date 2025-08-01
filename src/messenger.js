/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
'use strict';

const util = require('util');
const EventEmitter = require('events').EventEmitter;



function Messenger(options) {
  EventEmitter.apply(this, arguments);
  var o = options || {};
  if (o.mongooseOptions) {
    this.mongooseOptions = o.mongooseOptions;
  }
  const mongoose = o.mongoose || require('mongoose');
  this.mongoose = mongoose;

  const MessageSchema = new this.mongoose.Schema({
    channel: String,
    createdAt: { type: Date, expires: '15s', default: Date.now },
    message: mongoose.Schema.Types.Mixed,
  });
  this.Message = mongoose.models['PubSubMessage'] || mongoose.model('PubSubMessage', MessageSchema);
  this.subscribed = {};
  this.lastMessageId = null;
  this.lastMessageTimestamp = null;
  this.startingMessageTimestamp = new Date();
  this.retryInterval = o.retryInterval || 100;
  this.stream = null; // Store stream reference to prevent memory leaks

  // Enhanced error handling properties
  this.maxRetries = o.maxRetries || 10;
  this.retryCount = 0;
  this.baseRetryDelay = o.baseRetryDelay || 1000; // 1 second base delay
  this.maxRetryDelay = o.maxRetryDelay || 30000; // 30 seconds max delay
  this.connectionState = 'disconnected'; // 'connecting', 'connected', 'disconnected', 'error'
  this.reconnecting = false;
}

util.inherits(Messenger, EventEmitter);

Messenger.prototype.send = async function (channel, msg, callback) {
  var cb = function noop() { };
  if (typeof callback === 'function') {
    cb = callback;
  }
  var message = new this.Message({
    channel: channel,
    message: msg
  });
  try {
    await message.save();
    cb(message)
  } catch (e) {
    cb(e)
  }
};

Messenger.prototype.connect = function (callback) {
  var self = this;

  // Prevent multiple connection attempts
  if (this.connectionState === 'connecting') {
    if (callback) callback(new Error('Connection already in progress'));
    return;
  }

  this.connectionState = 'connecting';
  this.emit('connecting');

  // Clean up existing stream to prevent memory leaks
  if (this.stream) {
    this.stream.removeAllListeners();
    if (this.stream.destroy) {
      this.stream.destroy();
    }
    this.stream = null;
  }

  try {
    if (this.mongoose.connection.readyState == 0 && self.mongooseOptions) {
      this.mongoose.connect(self.mongooseOptions.url, self.mongooseOptions.options)
    }

    const pipeline = [
      {
        $match: {
          $or: [{ operationType: 'insert' }],
        },
      },
    ];

    this.stream = this.Message.watch(pipeline, { fullDocument: 'updateLookup' });

    this.stream.on('change', function data(doc) {
      const { fullDocument } = doc;
      if (fullDocument && self.subscribed[fullDocument.channel] && self.lastMessageId != fullDocument._id) {
        self.lastMessageId = fullDocument._id;
        self.lastMessageTimestamp = fullDocument.createdAt;
        self.emit(fullDocument.channel, fullDocument.message);
      }
    });

    // Enhanced error handling
    this.stream.on('error', function streamError(error) {
      self.connectionState = 'error';
      self.emit('error', error);
      self._handleStreamError(error);
    });

    this.stream.on('close', function streamClose() {
      if (self.connectionState !== 'disconnected') {
        self.connectionState = 'disconnected';
        self.emit('disconnected');
        self._handleStreamClose();
      }
    });

    // Mark as connected when stream is ready
    this.stream.on('resumeToken', function () {
      self.connectionState = 'connected';
      self.retryCount = 0; // Reset retry count on successful connection
      self.reconnecting = false;
      self.emit('connected');
    });

    if (callback) callback();

  } catch (error) {
    this.connectionState = 'error';
    this.emit('error', error);
    if (callback) callback(error);
    this._scheduleReconnect(error);
  }
};

Messenger.prototype.subscribe = function (channel, bool) {
  var self = this;
  if (channel && bool) {
    self.subscribed[channel] = bool;
    return;
  }
  if (channel && self.subscribed[channel]) {
    delete self.subscribed[channel];
  }
};

Messenger.prototype.disconnect = function () {
  // Set state to prevent reconnection
  this.connectionState = 'disconnected';
  this.reconnecting = false;

  // Clean up stream to prevent memory leaks
  if (this.stream) {
    this.stream.removeAllListeners();
    if (this.stream.destroy) {
      this.stream.destroy();
    }
    this.stream = null;
  }

  this.emit('disconnected');
};

// Enhanced error handling methods
Messenger.prototype._handleStreamError = function (error) {
  var self = this;

  // Clean up current stream
  if (this.stream) {
    this.stream.removeAllListeners();
    if (this.stream.destroy) {
      this.stream.destroy();
    }
    this.stream = null;
  }

  // Emit error details
  this.emit('error', {
    type: 'stream_error',
    error: error,
    retryCount: this.retryCount,
    willRetry: this.retryCount < this.maxRetries
  });

  this._scheduleReconnect(error);
};

Messenger.prototype._handleStreamClose = function () {
  var self = this;

  // Clean up current stream
  if (this.stream) {
    this.stream.removeAllListeners();
    if (this.stream.destroy) {
      this.stream.destroy();
    }
    this.stream = null;
  }

  // Only reconnect if not intentionally disconnected
  if (this.connectionState !== 'disconnected') {
    this.emit('disconnected', {
      type: 'stream_close',
      retryCount: this.retryCount,
      willRetry: this.retryCount < this.maxRetries
    });

    this._scheduleReconnect(new Error('Stream closed unexpectedly'));
  }
};

Messenger.prototype._scheduleReconnect = function (error) {
  var self = this;

  // Don't reconnect if explicitly disconnected or max retries exceeded
  if (this.connectionState === 'disconnected' || this.reconnecting) {
    return;
  }

  if (this.retryCount >= this.maxRetries) {
    this.connectionState = 'error';
    this.emit('maxRetriesExceeded', {
      error: error,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries
    });
    return;
  }

  this.reconnecting = true;
  this.retryCount++;

  // Calculate exponential backoff delay
  var delay = Math.min(
    this.baseRetryDelay * Math.pow(2, this.retryCount - 1),
    this.maxRetryDelay
  );

  // Add jitter to prevent thundering herd
  delay = delay + (Math.random() * 1000);

  this.emit('reconnecting', {
    attempt: this.retryCount,
    maxRetries: this.maxRetries,
    delay: delay,
    error: error
  });

  setTimeout(function () {
    if (self.connectionState !== 'disconnected') {
      self.reconnecting = false;
      self.connect();
    }
  }, delay);
};

// Get current connection status
Messenger.prototype.getConnectionState = function () {
  return {
    state: this.connectionState,
    retryCount: this.retryCount,
    maxRetries: this.maxRetries,
    reconnecting: this.reconnecting
  };
};

// Reset retry counter (useful for manual reconnection)
Messenger.prototype.resetRetryCount = function () {
  this.retryCount = 0;
};

module.exports = Messenger;