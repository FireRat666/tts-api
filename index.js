/**
 * Run ./api.js if you want to use a server!
 */

import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as TTS from '@sefinek/google-tts-api'
import { translate } from 'google-translate-api-x'
import Ffmpeg from 'fluent-ffmpeg'

export default async function main(payload, tmp = '', ffmpegPath = '') {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
    'Cache-Control': 'public, max-age=31536000, immutable'
  }
  let { text, lang, speed, pitch = 1 } = payload

  if (!text || !text.length) {
    return new Response(await readFile('./README.md'), {
      status: 200,
      statusText: '`text` is missing',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        ...headers
      }
    })
  }

  try {
    text = decodeURIComponent(text)
  } catch (e) {}

  if (!lang || typeof lang !== 'string' || !lang.trim().length) {
    lang = 'auto'
  } else {
    lang = lang.trim()
  }

  if (lang === 'auto') {
    try {
      const res = await translate(text)

      if (Array.isArray(res)) {
        lang = res[0]?.from?.language?.iso || 'en'
      } else {
        lang = res?.from?.language?.iso || 'en'
      }
    } catch (error) {
      console.error(error)
      lang = 'en'
    }
  }

  let audios
  try {
    audios = await TTS.getAllAudioBase64(text, { lang })
  } catch (error) {
    if (lang !== 'en') {
      console.warn('TTS failed for lang %s, falling back to "en":', lang, error?.message)
      lang = 'en'
      audios = await TTS.getAllAudioBase64(text, { lang: 'en' })
    } else {
      throw error
    }
  }

  const ffmpeg = Ffmpeg()
  const files = []

  if (ffmpegPath.length) ffmpeg.setFfmpegPath(ffmpegPath)

  try {
    for (const { base64 } of audios) {
      const path = join(tmp, `${randomUUID()}.mp3`)
      const buffer = Buffer.from(base64, 'base64')

      files.push(path)
      ffmpeg.addInput(path)
      await writeFile(path, buffer)
    }

    const sample = 44100
    const setrate = sample * pitch
    const tempo = speed || (1 + (1 - pitch))
    const chunks = []

    await new Promise((resolve, reject) => ffmpeg
      .complexFilter([
        { filter: 'concat', options: { n: files.length, v: 0, a: 1 }, outputs: 'merged' },
        { filter: 'aresample', options: sample, inputs: 'merged', outputs: 'resampled' },
        { filter: 'asetrate', options: setrate, inputs: 'resampled', outputs: 'rated' },
        { filter: 'atempo', options: tempo, inputs: 'rated', outputs: 'final' },
      ])
      .outputOptions('-map [final]')
      .on('end', resolve)
      .on('error', reject)
      .outputFormat('mp3')
      .pipe()
      .on('data', chunk => chunks.push(chunk))
    )

    return new Response(Buffer.concat(chunks), {
      status: 200,
      headers: {
        'content-type': 'audio/mp3',
        'content-disposition': 'inline',
        ...headers
      }
    })
  } finally {
    for (const file of files) {
      unlink(file).catch(() => {})
    }
  }
}
