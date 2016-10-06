'use strict'

// Support mocha.
var bench = global.bench || function () {}

const isIP = process.binding('cares_wrap').isIP

function ipVersion (ip) {
  if (ip.indexOf(':') > -1) {
    return 6
  }
  if (/^[0-9\.]+$/.test(ip)) {
    return 4
  }
  return 0
}

bench('IP Version', function () {
  is(isIP('127.0.0.1'), 4)
  is(isIP('::'), 6)
  is(isIP('localhost'), 0)
  is(ipVersion('127.0.0.1'), 4)
  is(ipVersion('::'), 6)
  is(ipVersion('localhost'), 0)

  it('cares', function () {
    isIP('127.0.0.1')
    isIP('::')
    isIP('localhost')
  })

  it('RegExp', function () {
    ipVersion('127.0.0.1')
    ipVersion('::')
    ipVersion('localhost')
  })
})
