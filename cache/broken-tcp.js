'use strict'

const Type = require('lighter-type')
const Emitter = require('lighter-emitter')
const stream = require('./lighter-stream')
const util = require('util')
const cares = process.binding('cares_wrap')
const uv = process.binding('uv')
const Buffer = require('buffer').Buffer
const TcpWrap = process.binding('tcp_wrap')
const Tcp = TcpWrap.TCP
const TCPConnectWrap = TcpWrap.TCPConnectWrap
const StreamWrap = process.binding('stream_wrap')
const WriteWrap = StreamWrap.WriteWrap
const dns = require('dns')

const errnoException = util._errnoException
const exceptionWithHostPort = util._exceptionWithHostPort

const defaultHost = 'localhost'
const defaultPort = 9876

var Server = exports.Server = Emitter.extend(function TcpServer (options) {
  options = options || 0
  this._events = this._events || new this.constructor.Events()
  this._connections = 0
  this._handle = null
  this.port = options.port || defaultPort
  this.host = options.host || defaultHost
  if (options.onConnection) {
    this.on('connection', options.onConnection)
  }
  this.listen()
}, {

  listen: function () {
    var host = this.host
    var port = this.port
    var ipType = cares.isIP(host)
    var handle = new Tcp()

    var err = (ipType === 6)
      ? handle.bind6(host, port)
      : handle.bind(host, port)

    if (err) {
      handle.close()
      return err
    }

    if (typeof handle === 'number') {
      this._handle = null
      err = exceptionWithHostPort(handle, 'listen', host, port)
      process.nextTick(emitErrorNT, this, err)
      return
    }

    this._handle = handle
    handle.onconnection = onconnection
    handle.owner = this

    err = handle.listen()

    if (err) {
      var ex = exceptionWithHostPort(err, 'listen', host, port)
      handle.close()
      this._handle = null
      process.nextTick(emitErrorNT, this, ex)
      return
    }
    this.emit('listening')
  }

}, {

  Events: Type.extend(function TcpEvents () {}, {
    error: function (error) {
      throw error
    }
  })
})

/*
var noHandle = {
  close: no,
  bind: no,
  bind6: no,
  connect: no,
  connect6: no,
  getpeername: no,
  getsockname: no
}
*/

function no () {}

const BYTES_READ = Symbol('bytesRead')

function Socket (options) {
  options = options || 0
  stream.Duplex.call(this, options)
  this._connecting = false
  this._host = null

  var handle = this._handle = options.handle || new Tcp()
  handle.owner = this
  handle.onread = onread
  this.readable = this.writable = true

  // shut down the socket when we're finished with it.
  this.on('finish', this.destroy)

  // Reserve properties.
  this._server = options.server || null

  // Used after `.destroy()`
  this[BYTES_READ] = 0
}
util.inherits(Socket, stream.Duplex)

exports.Socket = Socket

Socket.prototype.setKeepAlive = function (setting, msecs) {
  if (!this._handle) {
    this.once('connect', () => this.setKeepAlive(setting, msecs))
    return this
  }

  if (this._handle.setKeepAlive) {
    this._handle.setKeepAlive(setting, ~~(msecs / 1000))
  }

  return this
}

Object.defineProperty(Socket.prototype, 'bufferSize', {
  get: function () {
    if (this._handle) {
      return this._handle.writeQueueSize + this._writableState.length
    }
  }
})

// Just call handle.readStart until we have enough in the buffer
Socket.prototype._read = function (n) {
  if (this._connecting || !this._handle) {
    this.once('connect', () => this._read(n))
  } else if (!this._handle.reading) {
    // not already reading, start the flow
    this._handle.reading = true
    var err = this._handle.readStart()
    if (err) {
      this.destroy(errnoException(err, 'read'))
    }
  }
}

Socket.prototype.destroy = function (exception, cb) {
  var self = this
  this._connecting = false
  this.readable = this.writable = false

  if (this._handle) {
    // `bytesRead` should be accessible after `.destroy()`
    this[BYTES_READ] = this._handle.bytesRead

    this._handle.close(function () {
      self.emit('close', !!exception)
    })
    this._handle.onread = no
    this._handle = null
  }

  if (this._server) {
    // COUNTER_NET_SERVER_CONNECTION_CLOSE(this)
    this._server._connections--
  }
}

// This function is called whenever the handle gets a
// buffer, or when there's an error reading.
function onread (nread, buffer) {
  var handle = this
  var self = handle.owner

  if (nread > 0) {
    // read success.
    // In theory (and in practice) calling readStop right now
    // will prevent this from being called again until _read() gets
    // called again.

    // Optimization: emit the original buffer with end points
    var ret = self.push(buffer)

    if (handle.reading && !ret) {
      handle.reading = false
      var err = handle.readStop()
      if (err) {
        self.destroy(errnoException(err, 'read'))
      }
    }
    return
  }

  // if we didn't get any bytes, that doesn't necessarily mean EOF.
  // wait for the next one.
  if (nread === 0) {
    return
  }

  // Error, possibly EOF.
  if (nread !== uv.UV_EOF) {
    return self.destroy(errnoException(nread, 'read'))
  }

  if (self._readableState.length === 0) {
    self.readable = false
  }

  // push a null to signal the end of data.
  self.push(null)
}

function protoGetter (name, callback) {
  Object.defineProperty(Socket.prototype, name, {
    configurable: false,
    enumerable: true,
    get: callback
  })
}

protoGetter('bytesRead', function bytesRead () {
  return this._handle ? this._handle.bytesRead : this[BYTES_READ]
})

protoGetter('remote', function remote () {
  var remote = this._remote
  if (!remote) {
    var handle = this._handle
    if (!handle || !handle.getpeername) {
      return 0
    }
    remote = {}
    var error = handle.getpeername(remote)
    if (error) return 0
    this._remote = remote
  }
  return remote
})

protoGetter('local', function local () {
  var local = this._local
  if (!local) {
    var handle = this._handle
    if (!handle || !handle.getsockname) {
      return 0
    }
    local = {}
    var error = handle.getsockname(local)
    if (error) return 0
    this._local = local
  }
  return local
})

Socket.prototype._write = function (data, encoding, cb) {
  // If we are still connecting, then buffer this for later.
  // The Writable logic will buffer up any more writes while
  // waiting for this one to be done.
  if (this._connecting) {
    return this.once('connect', function () {
      this._write(data, encoding, cb)
    })
  }

  if (!this._handle) {
    this.destroy(new Error('This socket is closed.'), cb)
    return false
  }

  var req = new WriteWrap()
  req.handle = this._handle
  req.async = false
  var err
  if (data instanceof Buffer) {
    req.buffer = data // Keep reference alive.
    err = this._handle.writeBuffer(req, data)
  } else {
    err = this._handle.writeUtf8String(req, data)
  }

  if (err) {
    return this.destroy(errnoException(err, 'write', req.error), cb)
  }

  // If it was entirely flushed, we can write some more right now.
  // However, if more is left in the queue, then wait until that clears.
  if (req.async && this._handle.writeQueueSize !== 0) {
    req.cb = cb
  } else {
    cb()
  }
}

function connect (self, host, port, ipType) {
  const req = new TCPConnectWrap()
  req.oncomplete = afterConnect
  req.host = host
  req.port = port
  var error = (ipType === 4)
    ? self._handle.connect(req, host, port)
    : self._handle.connect6(req, host, port)

  if (error) {
    self.destroy(exceptionWithHostPort(error, 'connect', host, port))
  }
}

Socket.prototype.connect = function (options) {
  var self = this

  this._connecting = true
  this.writable = true

  var host = options.host || defaultHost
  var port = options.port || defaultPort

  // If host is an IP, skip performing a lookup
  var ipType = cares.isIP(host)
  if (ipType) {
    if (this._connecting) {
      connect(this, host, port, ipType)
    }
    return
  }

  var dnsopts = {
    family: options.family,
    hints: 0
  }

  if (dnsopts.family !== 4 && dnsopts.family !== 6) {
    dnsopts.hints = dns.ADDRCONFIG
    // The AI_V4MAPPED hint is not supported on FreeBSD or Android,
    // and getaddrinfo returns EAI_BADFLAGS. However, it seems to be
    // supported on most other systems. See
    // http://lists.freebsd.org/pipermail/freebsd-bugs/2008-February/028260.html
    // for more information on the lack of support for FreeBSD.
    if (process.platform !== 'freebsd' && process.platform !== 'android') {
      dnsopts.hints |= dns.V4MAPPED
    }
  }

  this._host = host
  var lookup = options.lookup || dns.lookup
  lookup(host, dnsopts, function (err, ip, ipType) {
    self.emit('lookup', err, ip, ipType)
    if (!self._connecting) return
    if (err) {
      err.host = options.host
      err.port = options.port
      err.message = err.message + ' ' + options.host + ':' + options.port
      process.nextTick(connectErrorNT, self, err)
    } else {
      connect(self, ip, port, ipType)
    }
  })
  return this
}

function connectErrorNT (self, err) {
  self.emit('error', err)
  self.destroy()
}

function afterConnect (status, handle, req, readable, writable) {
  var self = handle.owner

  self._connecting = false

  if (status === 0) {
    self.readable = readable
    self.writable = writable

    self.emit('connect')
  } else {
    self._connecting = false
    self.destroy(exceptionWithHostPort(status, 'connect', req.host, req.port))
  }
}

function emitErrorNT (self, err) {
  self.emit('error', err)
}

function onconnection (err, handle) {
  var self = this.owner
  if (err) {
    return self.emit('error', errnoException(err, 'accept'))
  }
  self._connections++
  self.emit('connection', new Socket({handle: handle, server: self}))
}

exports.serve = function (options) {
  return new Server(options)
}
