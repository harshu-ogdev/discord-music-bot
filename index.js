function playAudio(guildId, channel, previewUrl) {
  const oldFFmpeg = ffmpegProcesses.get(guildId);

  if (oldFFmpeg) {
    try {
      oldFFmpeg.kill();
    } catch (error) {
      console.log("Old FFmpeg already stopped.");
    }
  }

  let player = players.get(guildId);

  if (!player) {
    player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });

    players.set(guildId, player);
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false
  });

  connections.set(guildId, connection);

  console.log("Starting FFmpeg...");
  console.log("Audio URL received.");

  const ffmpeg = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "verbose",
      "-i",
      previewUrl,
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1"
    ],
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  ffmpegProcesses.set(guildId, ffmpeg);

  ffmpeg.stderr.on("data", data => {
    console.log(`FFmpeg: ${data.toString()}`);
  });

  ffmpeg.stdout.on("data", () => {
    console.log("FFmpeg is sending audio data.");
  });

  ffmpeg.on("error", error => {
    console.error("FFmpeg process error:", error);
  });

  ffmpeg.on("close", (code, signal) => {
    console.log(
      `FFmpeg closed. Code: ${code}, Signal: ${signal}`
    );

    if (ffmpegProcesses.get(guildId) === ffmpeg) {
      ffmpegProcesses.delete(guildId);
    }
  });

  const resource = createAudioResource(
    ffmpeg.stdout,
    {
      inputType: StreamType.Raw
    }
  );

  player.play(resource);

  connection.subscribe(player);

  console.log("Audio player started.");
}
