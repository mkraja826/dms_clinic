const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const localGoogleServicesFile = "./google-services.json";
const coinDropSoundFile = "./assets/sounds/coin-drop.wav";

function writeUInt16LE(buffer, value, offset) {
  buffer.writeUInt16LE(value, offset);
}

function writeUInt32LE(buffer, value, offset) {
  buffer.writeUInt32LE(value, offset);
}

function ensureCoinDropSound() {
  if (existsSync(coinDropSoundFile)) return;

  const sampleRate = 44_100;
  const durationSeconds = 0.72;
  const samples = Math.floor(sampleRate * durationSeconds);
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  writeUInt32LE(buffer, 36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  writeUInt32LE(buffer, 16, 16);
  writeUInt16LE(buffer, 1, 20);
  writeUInt16LE(buffer, channels, 22);
  writeUInt32LE(buffer, sampleRate, 24);
  writeUInt32LE(buffer, sampleRate * channels * bytesPerSample, 28);
  writeUInt16LE(buffer, channels * bytesPerSample, 32);
  writeUInt16LE(buffer, bitsPerSample, 34);
  buffer.write("data", 36);
  writeUInt32LE(buffer, dataSize, 40);

  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / 0.012);
    const decay = Math.exp(-time * 5.8);
    const firstTone = Math.sin(2 * Math.PI * 1_176 * time);
    const secondTone = Math.sin(2 * Math.PI * 1_568 * time) * 0.58;
    const softClick = Math.sin(2 * Math.PI * 2_350 * time) * Math.exp(-time * 18) * 0.22;
    const sample = Math.max(-1, Math.min(1, (firstTone + secondTone + softClick) * attack * decay * 0.38));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }

  mkdirSync(dirname(coinDropSoundFile), { recursive: true });
  writeFileSync(coinDropSoundFile, buffer);
}

module.exports = ({ config }) => {
  ensureCoinDropSound();

  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ||
    (existsSync(localGoogleServicesFile)
      ? localGoogleServicesFile
      : undefined);

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
