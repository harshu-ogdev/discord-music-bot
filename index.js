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
// WEB SERVER FOR RENDER
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
    .setDescription("Make the bot join your voice channel"),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play audio from a direct audio URL")
    .addStringOption(option =>
      option
        .setName("url")
        .setDescription("Direct audio URL")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop the current audio"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Make the bot leave the voice channel")
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
      Routes.applicationCommands(client.user.id),
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
// COMMAND HANDLER
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;

  // =========================
  // /PING
  // =========================

  if (interaction.commandName === "ping") {
    return interaction.reply("🏓 Pong!");
  }

  // =========================
  // /JOIN
  // =========================

  if (interaction.commandName === "join") {
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply(
        "❌ You need to join a voice channel first."
      );
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator
    });

    connections.set(guildId, connection);

    return interaction.reply(
      "✅ Joined your voice channel!"
    );
  }

  // =========================
  // /PLAY
  // =========================

  if (interaction.commandName === "play") {
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply(
        "❌ Join a voice channel first!"
      );
    }

    const url = interaction.options.getString("url", true);

    // Check that the URL is valid
    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return interaction.reply(
        "❌ That doesn't look like a valid URL."
      );
    }

    // Only allow HTTP/HTTPS
    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      return interaction.reply(
        "❌ Only HTTP and HTTPS URLs are supported."
      );
    }

    await interaction.deferReply();

    try {
      // Join voice channel
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guildId,
        adapterCreator: channel.guild.voiceAdapterCreator
      });

      connections.set(guildId, connection);

      // Stop previous FFmpeg process
      const oldProcess = ffmpegProcesses.get(guildId);

      if (oldProcess) {
        oldProcess.kill();
      }

      // Create or reuse audio player
      let player = players.get(guildId);

      if (!player) {
        player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Stop
          }
        });

        players.set(guildId, player);
      }

      // Start FFmpeg
      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          url,
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

      ffmpegProcesses.set(guildId, ffmpeg);

      // Show FFmpeg errors in Render logs
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
          ffmpegProcesses.get(guildId) === ffmpeg
        ) {
          ffmpegProcesses.delete(guildId);
        }
      });

      // Create Discord audio resource
      const resource = createAudioResource(
        ffmpeg.stdout,
        {
          inputType: StreamType.Raw
        }
      );

      // Play audio
      player.play(resource);

      // Connect player to Discord
      connection.subscribe(player);

      await interaction.editReply(
        "▶️ Playing the audio!"
      );

    } catch (error) {
      console.error(
        "Play error:",
        error
      );

      await interaction.editReply(
        "❌ I couldn't play that audio URL."
      );
    }

    return;
  }

  // =========================
  // /STOP
  // =========================

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
      ffmpeg.kill();
      ffmpegProcesses.delete(guildId);
    }

    return interaction.reply(
      "⏹️ Stopped the music."
    );
  }

  // =========================
  // /LEAVE
  // =========================

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
      ffmpeg.kill();
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
