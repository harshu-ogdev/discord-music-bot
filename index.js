const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus
} = require("@discordjs/voice");

const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const express = require("express");

// =========================
// DISCORD CLIENT
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// =========================
// RENDER WEB SERVER
// =========================

const app = express();

app.get("/", (req, res) => {
  res.send("Discord music bot is running!");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server started");
});

// =========================
// STORAGE
// =========================

const connections = new Map();
const players = new Map();
const ffmpegProcesses = new Map();

// =========================
// SLASH COMMANDS
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is online"),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel"),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Search for a song and play it")
    .addStringOption(option =>
      option
        .setName("song")
        .setDescription("Song name or artist and song name")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop the current song"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the voice channel")
].map(command => command.toJSON());

// =========================
// BOT READY
// =========================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  if (!process.env.AUDIUS_API_KEY) {
    console.error("AUDIUS_API_KEY is missing!");
  }

  const rest = new REST({ version: "10" }).setToken(
    process.env.DISCORD_TOKEN
  );

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        "1532066190829293658"
      ),
      {
        body: commands
      }
    );

    console.log("Slash commands registered!");
  } catch (error) {
    console.error("Could not register commands:", error);
  }
});

// =========================
// AUDIUS API
// =========================

async function audiusRequest(url) {
  const response = await fetch(url, {
    headers: {
      "x-api-key": process.env.AUDIUS_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Audius API error: ${response.status}`);
  }

  return response.json();
}

// =========================
// SEARCH SONG
// =========================

async function searchSong(songName) {
  const url =
    "https://api.audius.co/v1/tracks/search?query=" +
    encodeURIComponent(songName) +
    "&limit=5";

  console.log(`Searching for: ${songName}`);

  const result = await audiusRequest(url);

  if (!result.data || result.data.length === 0) {
    return null;
  }

  const track = result.data.find(song =>
    song.isStreamable === true ||
    song.isStreamable === "true"
  );

  return track || null;
}

// =========================
// PLAY AUDIO
// =========================

async function playAudio(guildId, channel, trackId) {
  const oldFFmpeg = ffmpegProcesses.get(guildId);

  if (oldFFmpeg) {
    try {
      oldFFmpeg.kill("SIGTERM");
    } catch (error) {
      console.log("Old FFmpeg already stopped.");
    }

    ffmpegProcesses.delete(guildId);
  }

  let player = players.get(guildId);

  if (!player) {
    player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });

    players.set(guildId, player);

    player.on(AudioPlayerStatus.Playing, () => {
      console.log("Discord audio player is PLAYING.");
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log("Discord audio player is IDLE.");
    });

    player.on("error", error => {
      console.error("Discord audio player error:", error);
    });
  }

  player.stop();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false
  });

  connections.set(guildId, connection);

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log("Discord voice connection is READY.");
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.log("Discord voice connection DISCONNECTED.");
  });

  const streamUrl =
    `https://api.audius.co/v1/tracks/${trackId}/stream`;

  console.log("Starting full Audius stream...");

  const ffmpeg = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-headers",
      `x-api-key: ${process.env.AUDIUS_API_KEY}\r\n`,
      "-i",
      streamUrl,
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
    const message = data.toString().trim();

    if (message) {
      console.error(`FFmpeg: ${message}`);
    }
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

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw
  });

  connection.subscribe(player);

  player.play(resource);

  console.log("Full track playback started.");
}

// =========================
// COMMAND HANDLER
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const guildId = interaction.guildId;

  // /ping
  if (interaction.commandName === "ping") {
    return interaction.reply("🏓 Pong!");
  }

  // /join
  if (interaction.commandName === "join") {
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply(
        "❌ Join a voice channel first!"
      );
    }

    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false
      });

      connections.set(guildId, connection);

      return interaction.reply(
        "✅ Joined your voice channel!"
      );
    } catch (error) {
      console.error(error);

      return interaction.reply(
        "❌ I couldn't join the voice channel."
      );
    }
  }

  // /play
  if (interaction.commandName === "play") {
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply(
        "❌ Join a voice channel first!"
      );
    }

    const songName = interaction.options.getString(
      "song",
      true
    );

    await interaction.deferReply();

    try {
      const song = await searchSong(songName);

      if (!song) {
        return interaction.editReply(
          "❌ I couldn't find a streamable track for that search."
        );
      }

      await playAudio(
        guildId,
        channel,
        song.id
      );

      const artist =
        song.user?.name || "Unknown artist";

      await interaction.editReply(
        `▶️ Playing **${song.title}** by **${artist}**`
      );
    } catch (error) {
      console.error("Play error:", error);

      await interaction.editReply(
        "❌ I couldn't play that track. Check the Render logs."
      );
    }

    return;
  }

  // /stop
  if (interaction.commandName === "stop") {
    const player = players.get(guildId);

    if (!player) {
      return interaction.reply(
        "❌ Nothing is playing."
      );
    }

    player.stop();

    const ffmpeg = ffmpegProcesses.get(guildId);

    if (ffmpeg) {
      try {
        ffmpeg.kill("SIGTERM");
      } catch (error) {
        console.log("FFmpeg already stopped.");
      }

      ffmpegProcesses.delete(guildId);
    }

    return interaction.reply(
      "⏹️ Stopped the music."
    );
  }

  // /leave
  if (interaction.commandName === "leave") {
    const connection = connections.get(guildId);

    if (!connection) {
      return interaction.reply(
        "❌ I'm not in a voice channel."
      );
    }

    const player = players.get(guildId);

    if (player) {
      player.stop();
    }

    const ffmpeg = ffmpegProcesses.get(guildId);

    if (ffmpeg) {
      try {
        ffmpeg.kill("SIGTERM");
      } catch (error) {
        console.log("FFmpeg already stopped.");
      }

      ffmpegProcesses.delete(guildId);
    }

    connection.destroy();

    connections.delete(guildId);
    players.delete(guildId);

    return interaction.reply(
      "👋 Left the voice channel!"
    );
  }
});

// =========================
// LOGIN
// =========================

client.login(process.env.DISCORD_TOKEN);
