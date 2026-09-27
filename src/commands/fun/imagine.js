const {
    SlashCommandBuilder,
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const fetch = (...args) =>
  import("node-fetch").then(mod => mod.default(...args));

module.exports = {
    data: new SlashCommandBuilder()
        .setName("imagine")
        .setDescription("Génère une image IA gratuitement et sans limite.")
        .addStringOption(option =>
            option.setName("prompt")
                .setDescription("Description de l’image à générer")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("style")
                .setDescription("Style visuel")
                .addChoices(
                    { name: "Neon", value: "neon" },
                    { name: "Anime", value: "anime" },
                    { name: "Réaliste", value: "realistic" },
                    { name: "Dark", value: "dark" },
                    { name: "Cute", value: "cute" },
                    { name: "Tech futuriste", value: "tech" }
                )
        ),

    async execute(interaction) {
        const prompt = interaction.options.getString("prompt");
        const style = interaction.options.getString("style") || "default";

        // Styles IA gratuits
        const styleMap = {
            neon: "neon futuristic glowing blue violet cyberpunk",
            anime: "anime style, manga, vibrant colors",
            realistic: "ultra realistic, 8k, detailed",
            dark: "dark, dramatic lighting, shadows",
            cute: "kawaii, adorable, soft colors",
            tech: "futuristic holograms, sci-fi interface"
        };

        const finalPrompt =
            style !== "default"
                ? `${prompt}, ${styleMap[style]}`
                : prompt;

        // ID unique de génération
        const generationID = Math.floor(Math.random() * 999999);

        // Embed de génération
        const loadingEmbed = new EmbedBuilder()
            .setColor("#8A2BE2")
            .setTitle("🔷 Génération IA en cours…")
            .setDescription(
                `🖼️ **Prompt :** \`${prompt}\`\n` +
                `🎨 **Style :** \`${style}\`\n\n` +
                `⏳ *Temps estimé : 3 à 6 secondes*\n` +
                `⚙️ *ID de génération :* \`${generationID}\`\n\n` +
                `▰▰▰▱▱  **40%**\n` +
                `La magie opère… ✨`
            )
            .setFooter({ text: "Bumpify IA — Génération gratuite" });

        await interaction.reply({ embeds: [loadingEmbed] });

        try {
            // API gratuite Pollinations
            const imageURL = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}`;

            // Télécharger l'image
            const response = await fetch(imageURL);
            const buffer = await response.arrayBuffer();
            const file = new AttachmentBuilder(Buffer.from(buffer), {
                name: "image.png"
            });

            // Embed final
            const finalEmbed = new EmbedBuilder()
                .setColor("#9A3DFF")
                .setTitle("🔷 Image générée avec succès")
                .setDescription(
                    `🖼️ **Prompt :** \`${prompt}\`\n` +
                    `🎨 **Style :** \`${style}\`\n\n` +
                    `⚙️ **ID :** \`${generationID}\`\n` +
                    `📊 **Modèle :** Pollinations Free AI\n` +
                    `💠 **Qualité :** Standard\n` +
                    `🌐 **API :** Pollinations.ai\n`
                )
                .setImage("attachment://image.png")
                .setFooter({ text: "Bumpify IA — Génération gratuite" });

            // Bouton regénérer
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("regen")
                    .setLabel("🔁 Regénérer")
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.followUp({
                embeds: [finalEmbed],
                files: [file],
                components: [row]
            });

        } catch (err) {
            console.error(err);
            await interaction.followUp("❌ Erreur lors de la génération.");
        }
    }
};
