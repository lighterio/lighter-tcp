'use strict'

// Support mocha.
var is = global.is || require('exam/lib/is')

var tcp = require('../lighter-tcp')

describe('TCP', function () {
  it('sends and receives', function (done) {
    var port = 9891
    var server = tcp.serve({
      port: port,
      connection: function (socket) {
        socket.write('Hello, ')
        socket.on('data', function (who) {
          socket.write(who + '!')
        })
      }
    })
    var socket = tcp.connect({port: port})
    var data = ''
    socket.write('Sam')
    socket.on('data', function (chunk) {
      is(server._connections, 1)
      data += chunk
      if (data === 'Hello, Sam!') {
        socket.close()
        server.once('idle', function () {
          server.close(done)
        })
      }
    })
  })

  var port = 9898
  var server = tcp.serve({port: port, connection: function (socket) {
    socket.write('Hi!')
  }})

  function connect (host, done) {
    var socket = tcp.connect({
      port: port,
      host: host,
      data: function (chunk) {
        is(chunk.toString(), 'Hi!')
        socket.close(done)
      }
    })
  }

  it('works on 127.0.0.1', function (done) {
    connect('127.0.0.1', done)
  })

  it('works on localhost', function (done) {
    connect('localhost', done)
  })

  after(function (done) {
    server.close(done)
  })
})
