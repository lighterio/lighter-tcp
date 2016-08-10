'use strict'

var Emitter = require('lighter-emitter')
var Type = Emitter._super
var util = require('util')
var bind = process.binding
var Buffer = require('buffer').Buffer
var TcpWrap = bind('tcp_wrap')
var Tcp = TcpWrap.TCP
var TcpConnectWrap = TcpWrap.TCPConnectWrap
var WriteWrap = bind('stream_wrap').WriteWrap
var uv = bind('uv')
var dns = require('dns')
var cluster = require('cluster')
var isMaster = cluster.isMaster
var EOF = uv.UV_EOF
var ECONNRESET = uv.UV_ECONNRESET
var errnoException = util._errnoException
var exceptionWithHostPort = util._exceptionWithHostPort
var dnsOptions = {hints: dns.ADDRCONFIG}

/* istanbul ignore next */
if (!(process.platform in ['freebsd', 'android'])) {
  dnsOptions.hints |= dns.V4MAPPED
}

exports.serve = function (options) {
  return new Server(options)
}

exports.connect = function (options) {
  return new Socket(options)
}

exports.defaultHost = '0.0.0.0'
exports.defaultPort = 8080

var Server = exports.Server = Emitter.extend(function TcpServer (options) {
  options = options || 0
  this._events = this._events || new this.constructor.Events()
  this._connections = 0
  this.port = options.port || exports.defaultPort

  if (options.connection) {
    this.on('connection', options.connection)
  }
  if (options.data) {
    this.on('data', options.data)
  }
  if (options.error) {
    this.on('error', options.error)
  }
  if (isMaster) {
    this.listen()
  } else {
    this.cluster()
  }
}, {

  _handle: noHandle,

  cluster: function () {
    var self = this
    cluster._getServer(this, {
      address: null,
      port: this.port,
      addressType: 4,
      flags: 0
    }, function (error, handle) {
      if (error === 0 && handle.getsockname) {
        var out = {}
        error = handle.getsockname(out)
        if (error === 0 && self.port !== out.port) {
          error = uv.UV_EADDRINUSE
        }
      }
      if (error) {
        self.fail(error, 'bind')
      }
      self._handle = handle
      handle.onconnection = onConnection
      handle.owner = self

      error = handle.listen()
      if (error) {
        return this.fail(error, 'listen')
      }
    })
  },

  listen: function () {
    var port = this.port
    var handle = this._handle = new Tcp()
    var error = handle.bind('127.0.0.1', port)

    if (error) {
      return this.fail(error, 'bind')
    }

    handle.onconnection = onConnection
    handle.owner = this

    error = handle.listen()
    if (error) {
      return this.fail(error, 'listen')
    }
  },

  fail: function (error, action) {
    if (action) {
      var host = this.host || exports.defaultHost
      error = exceptionWithHostPort(error, action, host, this.port)
    }
    this.emit('error', error)
    this.close()
  },

  close: function (fn) {
    var self = this
    var handle = this._handle
    handle.close(function () {
      if (self._events.close) {
        self.emit('close')
      }
      if (fn) {
        fn.call(self)
      }
    })
    handle.onread = no
    this._handle = noHandle
    var server = this.server
    if (server) {
      if (!--server._connections) {
        server.emit('idle')
      }
    }
  }
})

var Events = Type.extend(function TcpEvents () {}, {
  error: function (error) {
    throw error
  }
})

var noHandle = {
  bind: no,
  bind6: no,
  connect: no,
  connect6: no,
  listen: no,
  readStart: no,
  onread: no,
  writeBuffer: no,
  writeUtf8String: no,
  setKeepAlive: no,
  getpeername: no,
  getsockname: no,
  close: no
}

function no () {}

var Socket = exports.Socket = Emitter.extend(function Socket (options) {
  options = options || 0
  this._events = new Server.Events()
  this.ip = ''
  this.host = options.host || exports.defaultHost
  this.port = options.port || exports.defaultPort

  var handle = this._handle = options.handle || new Tcp()
  handle.owner = this
  handle.onread = onRead

  if (options.data) {
    this.on('data', options.data)
  }
  if (options.connect) {
    this.on('connect', options.connect)
  }

  var server = this.server = options.server || null
  if (server) {
    this.open()
  } else {
    this.write = writeSoon
    this.connect()
  }
}, {

  setKeepAlive: function (setting, msecs) {
    this._handle.setKeepAlive(setting, ~~(msecs / 1000))
    return this
  },

  resolveIp: function () {
    var self = this
    var host = this.host
    var port = this.port
    dns.lookup(host, dnsOptions, function (error, ip, v) {
      if (error) {
        error.message += error.message + ' ' + host + ':' + port
        self.fail(error)
      } else {
        self.connect(ip, v)
      }
    })
  },

  connect: function (ip, v) {
    if (!ip) {
      ip = this.host
      v = ipv(ip)
      if (!v) {
        return this.resolveIp()
      }
    }
    this.ip = ip
    var port = this.port

    var wrap = new TcpConnectWrap()
    wrap.oncomplete = onComplete
    var error = (v === 4)
      ? this._handle.connect(wrap, ip, port)
      : this._handle.connect6(wrap, ip, port)

    if (error) {
      this.fail(exceptionWithHostPort(error, 'connect', ip, port))
    }
    return this
  },

  open: function open () {
    var error = this._handle.readStart()
    if (error) {
      this.fail(errnoException(error, 'open'))
    }
  },

  write: write,
  fail: Server.prototype.fail,
  close: Server.prototype.close
})

Type.decorate(Server, {
  Events: Events,
  Socket: Socket
})

function writeSoon (data) {
  return this.once('connect', function () {
    this.write(data)
  })
}

function write (data) {
  var handle = this._handle
  var writer = this.writer || new WriteWrap()
  writer.handle = handle
  writer.async = false
  var error
  if (data instanceof Buffer) {
    error = handle.writeBuffer(writer, data)
  } else {
    error = handle.writeUtf8String(writer, data)
  }
  if (error) {
    return this.fail(errnoException(error, 'write', writer.error))
  }
  this.writer = writer
}

function onRead (n, buffer) {
  var self = this.owner
  if (n > 0) {
    self.emit('data', buffer)
  } else if (n === EOF || n === ECONNRESET) {
    self.close()
  } else if (n < 0) {
    self.fail(errnoException(n, 'read'))
  }
}

function getter (name, fn) {
  Object.defineProperty(Socket.prototype, name, {
    configurable: false,
    enumerable: false,
    get: fn
  })
}

getter('remote', function remote () {
  var remote = this._remote
  if (!remote) {
    remote = {}
    var error = this._handle.getpeername(remote)
    if (error) return 0
    this._remote = remote
  }
  return remote
})

getter('local', function local () {
  var local = this._local
  if (!local) {
    local = {}
    var error = this._handle.getsockname(local)
    if (error) return 0
    this._local = local
  }
  return local
})

function ipv (ip) {
  if (ip.indexOf(':') > -1) {
    return 6
  }
  if (/^[0-9\.]+$/.test(ip)) {
    return 4
  }
  return 0
}

function onComplete (status, handle) {
  var self = handle.owner
  if (status === 0) {
    self.write = write
    self.open()
    self.emit('connect')
  } else {
    self.fail(exceptionWithHostPort(status, 'connect', self.host, self.port))
  }
}

function onConnection (error, handle) {
  var self = this.owner
  if (error) {
    return self.fail(errnoException(error, 'accept'))
  }
  self._connections++
  self.emit('connection', new self.constructor.Socket({
    handle: handle,
    server: self
  }))
}
