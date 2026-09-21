const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const { DisTube } = require("distube");
const { YouTubePlugin } = require("@distube/youtube");

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
// DISTUBE
// =========================

const distube = new DisTube(client, {
  emitNewSongOnly: true,
  plugins: [
    new YouTubePlugin()
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
    .setDescription("Play a YouTube video")
    .addStringOption(option =>
      option
        .setName("url")
        .setDescription("YouTube video URL")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop the current music"),

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
// DISTUBE EVENTS
// =========================

distube.on("playSong", (queue, song) => {
  console.log(
    `Playing: ${song.name}`
  );
});

distube.on("error", (error) => {
  console.error(
    "DisTube error:",
    error
  );
});

// =========================
// COMMAND HANDLER
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

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
        "❌ Join a voice channel first!"
      );
    }

    try {
      await distube.voices.join(channel);

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

  if (interaction.commandName === "play") {
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply(
        "❌ Join a voice channel first!"
      );
    }

    const url = interaction.options.getString(
      "url",
      true
    );

    if (
      !url.includes("youtube.com/") &&
      !url.includes("youtu.be/")
    ) {
      return interaction.reply(
        "❌ Please provide a YouTube video URL."
      );
    }

    await interaction.deferReply();

    try {
      await distube.play(channel, url, {
        textChannel: interaction.channel,
        member: interaction.member
      });

      await interaction.editReply(
        "▶️ Starting the video audio!"
      );
    } catch (error) {
      console.error(
        "Play error:",
        error
      );

      await interaction.editReply(
        "❌ I couldn't play that YouTube video."
      );
    }

    return;
  }

  // =========================
  // /STOP
  // =========================

  if (interaction.commandName === "stop") {
    try {
      const queue = distube.getQueue(
        interaction.guildId
      );

      if (!queue) {
        return interaction.reply(
          "❌ Nothing is playing."
        );
      }

      await distube.stop(interaction.guildId);

      return interaction.reply(
        "⏹️ Music stopped."
      );
    } catch (error) {
      console.error(error);

      return interaction.reply(
        "❌ I couldn't stop the music."
      );
    }
  }

  // =========================
  // /LEAVE
  // =========================

  if (interaction.commandName === "leave") {
    try {
      const queue = distube.getQueue(
        interaction.guildId
      );

      if (queue) {
        await distube.stop(
          interaction.guildId
        );
      }

      return interaction.reply(
        "👋 Left the voice channel!"
      );
    } catch (error) {
      console.error(error);

      return interaction.reply(
        "❌ I couldn't leave the voice channel."
      );
    }
  }
});

// =========================
// LOGIN
// =========================

client.login(
  process.env.DISCORD_TOKEN
);
