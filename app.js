require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

//Definitions
let utils = require('./utils.js');
const app = express();

//App configs
app.use(bodyParser.json());

/**
 * FOR INTERNAL API USE ONLY
 * Should not be exposed via express
 * Used to check whether or not a user's key is valid
 * @param {String} key
 * @param {String} bot_id
 * @param {String} requestedScope
 */

const checkValid = async (key, bot_id, requestedScope) => {
    if (bot_id == process.env.BANKER_ID) {
        return true;
    }
    return true;
    /**
     * This method should check in the airtable to see if a bot has those scopes
     * There should be a scope to determine whether or not it can noy only access the scopes for itself, but also for other users
     * For example, a bot like bank-slack should be able to directly access and deny invoices on behalf of others - but that shouldn't be inherent to anyone with the 'invoice' scope
     * This special scope can be called something like "manageUser" and this function will check if they have it - they won't ask for it.
     * */
};

/**
 * @param token - your banker API token
 * @param app_id - the ID of your slack bot
 * @param user - the user you want to fetch balance for
 */
app.post('/balance', async (req, res) => {
    let { token, app_id, user } = req.body;

    if (!(await checkValid(token, app_id, 'checkBalance'))) {
        res.sendStatus(403);
    }

    console.log(req.body);

    try {
        const balance = await utils.getBalance(user);
        console.log(`balance is being sent as ${balance}`);
        res.status(200).send({ balance: balance });
    } catch (err) {
        console.error(err);
        res.sendStatus(500);
    }
});

/**
 * ONLY GIVE THIS TO TRUSTED APPS! THIS IS DANGEROUS.
 * @param token - your auth token
 * @param app_id - ID of your slack app
 * @param to -
 * @param from
 * @param amount
 * @param reason
 */
app.post('/transfer', async (req, res) => {
    let { to, from, amount, reason } = req.body;

    if (!(await checkValid(token, app_id, 'transfer'))) {
        res.sendStatus(403);
        return null;
    }

    try {
        await utils.transferMoney(body.from, body.to, body.amount, body.reason);
    } catch (err) {
        if (err == 'InsufficientFundsError') {
            res.statusMessage = "You don't have enough money!";
            res.sendStatus(402);
        }
    }
    res.sendStatus(200);
});

/**
 * Allows creation of invoices to send to other users.
 * Should allow invoicing on behalf of other users
 *  - ideally this wouldn't be possible?
 *  - I'm not sure of a better way to handle it
 *  - without giving everyone their own token on app side.
 * @param token - the bot token
 * @param to - user who will receive invoice
 * @param from - user who will send invoice (and receive money) - presumably your bot (or verification will fail)
 * @param amount - the amount that will be paid for the invoice
 * @param reason - the reason for the invoice
 */
app.post('/invoice', async (req, res) => {
    let { to, from, amount, reason } = req.body;

    if (!(await checkValid(token, from, 'sendInvoice'))) {
        res.sendStatus(403);
        return null;
    }

    const newInvoice = await utils.sendInvoice(from, to, reason, amount);

    if (newInvoice) {
        res.sendStatus(200);
    } else {
        res.sendStatus(500);
    }
});

/**
 * Returns the pending invoices for a user or bot
 * @param token - token
 * @param user - the user for whom to fetch the invoices
 */
app.post('/pendingInvoices', async (req, res) => {
    let { token, user } = req.body;

    if (!checkValid(token, user, 'getInvoices')) {
        res.sendStatus(403);
        return null;
    }

    let pendingInvoices;
    try {
        pendingInvoices = await utils.getPendingInvoices(user);
    } catch (err) {
        res.sendStatus(500);
        return undefined;
    }
    res.send(JSON.stringify(pendingInvoices));
});

/**
 * Will deny an invoice.
 *  - I'm not sure the best way to limit this to specific users
 *  - Perhaps the best way is to create this for global deny
 * @param token
 * @param app_id
 * @param invoice_id
 */
app.post('/denyInvoice', async (req, res) => {
    let { token, app_id, invoice_id } = req.body;

    if (!(await checkValid(token, app_id, 'denyInvoice'))) {
        res.sendStatus(403);
        return null;
    }

    try {
        utils.denyInvoice(invoice_id);
    } catch (err) {
        res.sendStatus(500);
    }

    res.sendStatus(200);
});

//Dangerous - legacy scopes! They are here for backwars-compatibility with @neelr/bankerAPI.

/**
 * Support for old /give
 * @param bot_id - your bot's slack ID
 * @param send_id - slack ID of the person to send money to
 * @param gp - the amount of GP
 * @param token - auth token given by bank admins
 * @param reason - the reason for the transaction to occur
 */
app.post('/give', async (req, res) => {
    let { bot_id, send_id, gp, reason, token } = req.body;

    if (!checkValid(token, bot_id, 'give')) {
        res.sendStatus(403);
        return null;
    }

    try {
        const transferRecord = await utils.transferMoney(
            body.bot_id,
            body.send_id,
            body.gp,
            body.reason
        );
    } catch (err) {
        if (err == 'InsufficientFundsError') {
            res.statusMessage =
                "You don't have enough money to complete this transaction!";
            res.sendStatus(402); //sends "Payment Required"
        } else {
            res.sendStatus(500);
        }
    }
    res.sendStatus(200);

    if (transferRecord) {
        res.sendStatus(200);
    } else {
        res.sendStatus(500);
    }
});

/**
 * Yay another old scope that's incredibly dangerous, please do not give this to devs
 * This is dangerous because you can transfer money between random pepole's accounts for no reason
 * If this gets abused - blame @neelr <3
 * @param bot_id - your bot's slack UID
 * @param send_id - the UID of the person you want to fine
 * @param gp - the amount of GP you would like to fine
 * @param token - your bot's token
 * @param reason - the reason for the fine
 */
app.post('/fine', async (req, res) => {
    let { bot_id, send_id, gp, token, reason } = req.body;

    if (!checkValid(token, bot_id, 'fine')) {
        res.sendStatus(403);
        return null;
    }

    //transfers the money from the user to banker
    try {
        await utils.transferMoney(send_id, process.env.BANKER_ID, gp, reason);
    } catch (err) {
        console.error(err);
        if (err == 'InsufficientFundsError') {
            res.send('Insufficient funds!');
        } else {
            res.send(500);
        }
    }

    res.sendStatus(200);
});

app.listen(process.env.PORT || 3001, () => console.log('Listening!'));
