const { Telegraf, Markup } = require('telegraf');
const Calendar = require('telegraf-calendar-telegram');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const messages = JSON.parse(fs.readFileSync('messages.json', 'utf-8'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase  = createClient(supabaseUrl, supabaseKey)

const zones = {
    premium: ['Table 1', 'Table 2', 'Table 3'],
    american: ['Table 1', 'Table 2', 'Table 3', 'Table 4'],
    usual: ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5'],
    vip: ['Table 1']
};

const bot = new Telegraf(process.env.BOT_TOKEN);
const userLanguage = {};
const userSelections = {}; // Store user selections (zone, table, date, time)

bot.start((ctx) => {
    ctx.reply(
      "Пожалуйста выберите / Iltimos, tilni tanlang",
      Markup.keyboard([
        ['🇷🇺 Russian', '🇺🇿 Uzbek']
      ])
      .resize()
      .oneTime()
    );
});

bot.hears(['🇷🇺 Russian', '🇺🇿 Uzbek'], (ctx) => {
    const lang = ctx.message.text.includes('Russian') ? 'ru' : 'uz';
    userLanguage[ctx.from.id] = lang;
    userSelections[ctx.from.id] = {}; // Reset selections

    ctx.reply(
      messages[lang].welcome,
      Markup.keyboard([
        [Markup.button.contactRequest(messages[lang].share_phone)]
      ])
      .resize()
      .oneTime()
    );
});

// Handle contact information
bot.on('contact', (ctx) => {
    const phoneNumber = ctx.message.contact.phone_number;
    const lang = userLanguage[ctx.from.id] || 'ru';

    // ✅ Гарантируем, что объект существует
    if (!userSelections[ctx.from.id]) {
        userSelections[ctx.from.id] = {};
    }

    userSelections[ctx.from.id].phone = phoneNumber;

    ctx.reply(messages[lang].thank_you.replace('{phone}', phoneNumber));

    ctx.reply(
      messages[lang].choose_zone,
      Markup.keyboard([
        [messages[lang].zones.premium],
        [messages[lang].zones.american],
        [messages[lang].zones.usual],
        [messages[lang].zones.vip]
      ])
      .resize()
      .oneTime()
    );
});


// Handle zone selection
bot.hears([].concat(
    Object.values(messages['ru'].zones),
    Object.values(messages['uz'].zones)
), (ctx) => {
    const lang = userLanguage[ctx.from.id] || 'ru';
    const selectedZoneName = ctx.message.text;

    const selectedZoneKey = Object.keys(messages[lang].zones).find(
        key => messages[lang].zones[key] === selectedZoneName
    );

    if (!selectedZoneKey) return;

    userSelections[ctx.from.id].zone = selectedZoneName;
    const tables = zones[selectedZoneKey];

    const tableButtons = tables.map(table => [
        Markup.button.callback(messages[lang].tables[table], `select_${table}`)
    ]);

    ctx.reply(
      messages[lang].choose_table.replace('{zone}', selectedZoneName),
      Markup.inlineKeyboard(tableButtons)
    );
});

// Handle table selection
bot.action(/select_(.+)/, (ctx) => {
    const selectedTable = ctx.match[1];
    const lang = userLanguage[ctx.from.id] || 'ru';
    userSelections[ctx.from.id].table = messages[lang].tables[selectedTable];

    // ctx.replyWithMarkdown('📅 ' + messages[lang].choose_date.replace('{table}', userSelections[ctx.from.id].table));

    // Create a calendar for this user
    const calendar = new Calendar(bot, {
        startWeekDay: 1,
        weekDayNames: messages[lang].weekdays,
        monthNames: messages[lang].months
    });

    ctx.replyWithMarkdown('📅 ' + messages[lang].choose_date.replace('{table}', userSelections[ctx.from.id].table), calendar.getCalendar());
    
    calendar.setDateListener((ctx, date) => {
        userSelections[ctx.from.id].date = date;
        ctx.reply(messages[lang].choose_time.replace('{date}', date));
    });
});

// Handle manual time input
bot.hears(/^\d{1,2}:\d{2}$/, (ctx) => {
    const selectedTime = ctx.message.text;
    const lang = userLanguage[ctx.from.id] || 'ru';
    userSelections[ctx.from.id].time = selectedTime;

    ctx.reply(messages[lang].confirmation.replace('{time}', selectedTime),
        Markup.inlineKeyboard([
            [Markup.button.callback('✅ ' + messages[lang].confirm, 'confirm')],
            [Markup.button.callback('❌ ' + messages[lang].cancel, 'cancel')]
        ])
    );
});

// Handle confirmation
// Handle confirmation
bot.action('confirm', async (ctx) => {
    const lang = userLanguage[ctx.from.id] || 'ru';
    const booking = userSelections[ctx.from.id];

    if (!booking.phone || !booking.zone || !booking.table || !booking.date || !booking.time) {
        return ctx.reply(messages[lang].error);
    }

    // Save to Supabase
    const { data, error } = await supabase
        .from('reservations')
        .insert([
            {
                phone_number: booking.phone,
                zone: booking.zone,
                table_number: booking.table,
                date: booking.date,
                time: booking.time,
                user_id: ctx.from.id,
                username: ctx.from.username
            }
        ]);

    if (error) {
        console.error('Supabase Insert Error:', error);
        return ctx.reply(messages[lang].error);
    }

    // Send to another Telegram bot (admin bot)
    const adminChatId = process.env.ADMIN_CHAT_ID;
    const messageToAdmin = `📅 Новый заказ:\n👤 Телефон: ${booking.phone}\n📍 Зона: ${booking.zone}\n🎱 Стол: ${booking.table}\n🗓 Дата: ${booking.date}\n⏰ Время: ${booking.time}`;
    
    await ctx.telegram.sendMessage(adminChatId, messageToAdmin);

    // Show final message + "Reserve Again" button
    ctx.reply(
        messages[lang].final_confirmation,
        Markup.inlineKeyboard([
            [Markup.button.callback(messages[lang].reserve_again, 'reserve_again')]
        ])
    );
});

// Handle "Reserve Again" button click
bot.action('reserve_again', (ctx) => {
    const lang = userLanguage[ctx.from.id] || 'ru';

    // Reset user selections
    delete userSelections[ctx.from.id];

    // Restart the process from asking for phone number
    ctx.reply(messages[lang].welcome);
    ctx.reply(
        messages[lang].welcome,
        Markup.keyboard([
            [Markup.button.contactRequest(messages[lang].share_phone)]
        ])
        .resize()
        .oneTime()
    );
});



// Handle cancellation
bot.action('cancel', (ctx) => {
    const lang = userLanguage[ctx.from.id] || 'ru';
    userSelections[ctx.from.id] = {}; // Reset selections

    ctx.reply(messages[lang].restart);

    ctx.reply(
      messages[lang].choose_zone,
      Markup.keyboard([
        [messages[lang].zones.premium],
        [messages[lang].zones.american],
        [messages[lang].zones.usual],
        [messages[lang].zones.vip]
      ])
      .resize()
      .oneTime()
    );
});

// Launch the bot
bot.launch();
console.log('Bot is up and running...');
