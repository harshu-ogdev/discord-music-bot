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
  StreamType
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
// MUSIC STORAGE
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
    .setDescription("Search for a song and play its preview")
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
    console.error(
      "Could not register commands:",
      error
    );
  }
});

// =========================
// SEARCH DEEZER
// =========================

async function searchSong(songName) {
  const searchUrl =
    "https://api.deezer.com/search?q=" +
    encodeURIComponent(songName) +
    "&limit=1";

  const response = await fetch(searchUrl);

  if (!response.ok) {
    throw new Error(
      `Music search failed: ${response.status}`
    );
  }

  const data = await response.json();

  if (
    !data.data ||
    data.data.length === 0
  ) {
    return null;
  }

  return data.data[0];
}

// =========================
// PLAY PREVIEW
// =========================

function playAudio(guildId, channel, previewUrl) {
  // Stop previous FFmpeg
  const oldFFmpeg =
    ffmpegProcesses.get(guildId);

  if (oldFFmpeg) {
    oldFFmpeg.kill();
  }

  // Get or create player
  let player = players.get(guildId);

  if (!player) {
    player = createAudioPlayer({
      behaviors: {
        noSubscriber:
          NoSubscriberBehavior.Stop
      }
    });

    players.set(guildId, player);
  }

  // Join voice channel
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator:
      channel.guild.voiceAdapterCreator
  });

  connections.set(guildId, connection);

  // Start FFmpeg
  const ffmpeg = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
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
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    }
  );

  ffmpegProcesses.set(
    guildId,
    ffmpeg
  );

  ffmpeg.stderr.on("data", data => {
    console.log(
      `FFmpeg: ${data.toString()}`
    );
  });

  ffmpeg.on("error", error => {
    console.error(
      "FFmpeg error:",
      error
    );
  });

  ffmpeg.on("close", code => {
    console.log(
      `FFmpeg stopped with code ${code}`
    );

    if (
      ffmpegProcesses.get(guildId) ===
      ffmpeg
    ) {
      ffmpegProcesses.delete(guildId);
    }
  });

  // Create audio resource
  const resource =
    createAudioResource(
      ffmpeg.stdout,
      {
        inputType: StreamType.Raw
      }
    );

  // Start playing
  player.play(resource);

  // Connect player to Discord
  connection.subscribe(player);
}

// =========================
// COMMAND HANDLER
// =========================

client.on(
  "interactionCreate",
  async interaction => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    const guildId =
      interaction.guildId;

    // =========================
    // /PING
    // =========================

    if (
      interaction.commandName === "ping"
    ) {
      return interaction.reply(
        "🏓 Pong!"
      );
    }

    // =========================
    // /JOIN
    // =========================

    if (
      interaction.commandName === "join"
    ) {
      const channel =
        interaction.member.voice.channel;

      if (!channel) {
        return interaction.reply(
          "❌ Join a voice channel first!"
        );
      }

      try {
        const connection =
          joinVoiceChannel({
            channelId: channel.id,
            guildId: guildId,
            adapterCreator:
              channel.guild
                .voiceAdapterCreator
          });

        connections.set(
          guildId,
          connection
        );

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

    // =========================
    // /PLAY
    // =========================

    if (
      interaction.commandName === "play"
    ) {
      const channel =
        interaction.member.voice.channel;

      if (!channel) {
        return interaction.reply(
          "❌ Join a voice channel first!"
        );
      }

      const songName =
        interaction.options.getString(
          "song",
          true
        );

      await interaction.deferReply();

      try {
        console.log(
          `Searching for: ${songName}`
        );

        const song =
          await searchSong(songName);

        if (!song) {
          return interaction.editReply(
            "❌ I couldn't find that song."
          );
        }

        if (!song.preview) {
          return interaction.editReply(
            "❌ This song doesn't have an available preview."
          );
        }

        playAudio(
          guildId,
          channel,
          song.preview
        );

        await interaction.editReply(
          `▶️ Playing **${song.title}** by **${song.artist.name}**`
        );
      } catch (error) {
        console.error(
          "Play error:",
          error
        );

        await interaction.editReply(
          "❌ I couldn't play that song."
        );
      }

      return;
    }

    // =========================
    // /STOP
    // =========================

    if (
      interaction.commandName === "stop"
    ) {
      const player =
        players.get(guildId);

      if (!player) {
        return interaction.reply(
          "❌ Nothing is playing."
        );
      }

      player.stop();

      const ffmpeg =
        ffmpegProcesses.get(
          guildId
        );

      if (ffmpeg) {
        ffmpeg.kill();
        ffmpegProcesses.delete(
          guildId
        );
      }

      return interaction.reply(
        "⏹️ Stopped the music."
      );
    }

    // =========================
    // /LEAVE
    // =========================

    if (
      interaction.commandName === "leave"
    ) {
      const connection =
        connections.get(guildId);

      if (!connection) {
        return interaction.reply(
          "❌ I'm not in a voice channel."
        );
      }

      const player =
        players.get(guildId);

      if (player) {
        player.stop();
      }

      const ffmpeg =
        ffmpegProcesses.get(
          guildId
        );

      if (ffmpeg) {
        ffmpeg.kill();
        ffmpegProcesses.delete(
          guildId
        );
      }

      connection.destroy();

      connections.delete(guildId);
      players.delete(guildId);

      return interaction.reply(
        "👋 Left the voice channel!"
      );
    }
  }
);

// =========================
// LOGIN
// =========================

client.login(
  process.env.DISCORD_TOKEN
);
