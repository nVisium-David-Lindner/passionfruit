import { arrayFromNSArray, toJSON } from './lib/nsdict'
import uuidv4 from './lib/uuid'
import { open } from './lib/libc'
import { getDataAttrForPath } from './lib/foundation'

const { NSFileManager, NSProcessInfo, NSDictionary, NSBundle } = ObjC.classes

const fileManager = NSFileManager.defaultManager()


function ls(path, root) {
  const prefix = root === 'bundle' ?
    NSBundle.mainBundle().bundlePath().toString() :
    NSProcessInfo.processInfo().environment().objectForKey_('HOME').toString()

  const nsArray = fileManager.directoryContentsAtPath_([prefix, path].join('/'))
  const isDir = Memory.alloc(Process.pointerSize)

  if (!nsArray)
    return []

  const list = arrayFromNSArray(nsArray).map((filename) => {
    const fullPath = [prefix, path, filename].join('/')
    fileManager.fileExistsAtPath_isDirectory_(fullPath, isDir)

    return {
      /* eslint eqeqeq:0 */
      type: Memory.readPointer(isDir) == 0 ? 'file' : 'directory',
      name: filename,
      path: fullPath,
      attribute: getDataAttrForPath(fullPath) || {},
    }
  })

  return list
}


function plist(path) {
  try {
    const info = NSDictionary.dictionaryWithContentsOfFile_(path)
    return toJSON(info)
  } catch (ex) {
    throw new Error(`unable to parse file ${path} as plist,
      please make sure it does exist and is in valid format (${ex.stack})`)
  }
}

function text(path) {
  const name = Memory.allocUtf8String(path)
  const size = 10 * 1024 // max read size: 10k

  return new Promise((resolve, reject) => {
    const fd = open(name, 0, 0)
    if (fd === -1)
      reject(new Error(`unable to open file ${path}`))

    const stream = new UnixInputStream(fd, { autoClose: true })
    stream.read(size).then(resolve).catch(reject)
  })
}


function download(path) {
  const session = uuidv4()
  const name = Memory.allocUtf8String(path)
  const watermark = 10 * 1024 * 1024
  const subject = 'download'
  const { size } = getDataAttrForPath(path)

  const fd = open(name, 0, 0)
  if (fd === -1)
    throw new Error(`unable to open file ${path}`)

  const stream = new UnixInputStream(fd, { autoClose: true })
  const read = () => {
    stream.read(watermark).then((buffer) => {
      send({
        subject,
        event: 'data',
        session,
      }, buffer)

      if (buffer.byteLength === watermark) {
        setImmediate(read)
      } else {
        send({
          subject,
          event: 'end',
          session,
        })
      }
    }).catch((error) => {
      send({
        subject,
        event: 'error',
        session,
        error: error.message,
      })
    })
  }
  send({
    subject,
    event: 'start',
    session,
  })
  setImmediate(read)
  return {
    size,
    session,
  }
}

module.exports = {
  ls,
  plist,
  text,
  download,
}
