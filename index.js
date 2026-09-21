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
  AudioPlayerStatus,
  NoSubscriberBehavior
} = require("@discordjs/voice");

const express = require("express");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Simple web server for Render
const app = express();

app.get("/", (req, res) => {
  res.send("Discord music bot is running!");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server started");
});

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is online"),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Make the bot join your voice channel"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Make the bot leave the voice channel")
].map(command => command.toJSON());

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(
    process.env.DISCORD_TOKEN
  );

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log("Slash commands registered!");
  } catch (error) {
    console.error(error);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("🏓 Pong!");
  }

  if (interaction.commandName === "join") {
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply(
        "❌ You need to join a voice channel first."
      );
    }

    joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator
    });

    await interaction.reply("✅ Joined your voice channel!");
  }

  if (interaction.commandName === "leave") {
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply(
        "❌ You aren't in a voice channel."
      );
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator
    });

    connection.destroy();

    await interaction.reply("👋 Left the voice channel!");
  }
});

client.login(process.env.DISCORD_TOKEN);
