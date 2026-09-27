const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Balance = require('../../models/Balance');
const { COLORS, successEmbed } = require('../../utils/embeds');
const LEVELS = {
  facile:  { a:[1,20],  b:[1,20],  ops:['+','-'],       reward:5  },
  moyen:   { a:[1,50],  b:[1,50],  ops:['+','-','*'],    reward:15 },
  difficile:{ a:[1,100], b:[1,100], ops:['+','-','*','/'], reward:30 },
};
function gen(lvl) {
  const L=LEVELS[lvl];
  const a=Math.floor(Math.random()*(L.a[1]-L.a[0]+1))+L.a[0];
  let b=Math.floor(Math.random()*(L.b[1]-L.b[0]+1))+L.b[0];
  const op=L.ops[Math.floor(Math.random()*L.ops.length)];
  let answer;
  if(op==='/')  { b=b||1; const dividend=a*b; answer=String(a); return {q:`${dividend} ÷ ${b}`,answer,op}; }
  if(op==='-' && b>a) { [b] = [Math.floor(Math.random()*(a))+1]; }
  answer=String(op==='+'?a+b:op==='-'?a-b:a*b);
  return {q:`${a} ${op} ${b}`,answer,op};
}
module.exports = {
  data: new SlashCommandBuilder().setName('mathquiz').setDescription('🧮 Quiz maths — gagne des coins !')
    .addStringOption(o=>o.setName('difficulté').setDescription('Niveau').addChoices(
      {name:'😊 Facile (+5 coins)',    value:'facile'},
      {name:'😐 Moyen (+15 coins)',   value:'moyen'},
      {name:'😤 Difficile (+30 coins)',value:'difficile'},
    )),
  async execute(interaction) {
    const lvl  = interaction.options.getString('difficulté') || 'facile';
    const {q, answer} = gen(lvl);
    const modal = new ModalBuilder().setCustomId(`mq_${answer}_${lvl}`).setTitle('🧮 Calcule !');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('mq_answer').setLabel(`${q} = ?`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Votre réponse').setMaxLength(6),
    ));
    return interaction.showModal(modal);
  },
  async handleModal(interaction) {
    const parts  = interaction.customId.split('_');
    const answer = parts[1];
    const lvl    = parts[2];
    const given  = interaction.fields.getTextInputValue('mq_answer').trim();
    if(given===answer) {
      const reward = LEVELS[lvl]?.reward||5;
      await Balance.findOneAndUpdate({ userId:interaction.user.id, guildId:interaction.guildId }, { $inc:{coins:reward} }, { upsert:true });
      return interaction.reply({ embeds:[successEmbed(`✅ Bonne réponse ! +${reward} coins 🪙`,`La réponse était **${answer}**. Ton solde a augmenté de **${reward} coins** !`)], ephemeral:true });
    }
    return interaction.reply({ embeds:[new EmbedBuilder().setColor(COLORS.error).setTitle('❌ Mauvaise réponse').setDescription(`La réponse était **${answer}**. Tu as répondu **${given}**.`)], ephemeral:true });
  },
};
