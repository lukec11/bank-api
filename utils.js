require('dotenv').config();

/* Airtable stuff */
const Airtable = require('airtable');
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
Airtable.configure({
    endpointUrl: 'https://api.airtable.com',
    apiKey: process.env.AIRTABLE_API_KEY,
});

/* Set starting balance for new accounts */
var startBalance = 0;

const getUserRecord = async (user) => {
    let userRecord;
    try {
        userRecord = await base('bank')
            .select({ filterByFormula: `User = "${user}"` })
            .all();
    } catch (err) {
        console.error(err);
        throw 'AirtableError';
    }

    if (userRecord.length == 0) {
        console.log(`No balance found for ${user}.`);
        await createBalance();
    }

    return userRecord;
};

/**
 * Creates an airtable record for a user
 * @param {String} user - slack UID of the user to create
 */
const createBalance = async (user) => {
    console.log(`Creating balance record for ${user}.`);
    //Create new record in the db
    try {
        await base('bank').create({
            User: user,
            Balance: startBalance,
        });
    } catch (err) {
        console.error(err);
        throw 'AirtableError';
    }
    console.log(`New record created for ${user}!`);
};

/**
 * Returns the amount of money a user has
 * @param user - the slack ID of the user to be balanced
 */
const getBalance = async (user) => {
    if (user == undefined) {
        throw undefinedUser;
    }
    console.log(`INFO: Retrieving balance for ${user}`);

    //Get record of user
    let userRecord = await getUserRecord(user);

    //return the user's balance
    return await userRecord[0].fields.Balance;
};

/**
 *
 * @param {String} user - slack UID
 * @param {int} amount - new balance
 */
const setBalance = async (user, amount) => {
    const currentBalance = await getBalance(user);
    console.log(
        `TRNS: Updating value of ${user} from ${currentBalance} to ${amount}.`
    );

    const userRecord = await getUserRecord(user);
    const recordId = await userRecord[0].id;

    //update record based on said id
    try {
        await base('bank').update(recordId, {
            Balance: amount,
        });
    } catch (err) {
        console.error(err);
        throw 'Bad!';
    }

    console.log(`TRNS: Updated! New balance is ${await getBalance(user)}.`);
};

/**
 * Transfers money from one user to another.
 * @param {String} from - the user ID of the person giving the money
 * @param {String} to - the user ID of the person receiving the money
 * @param {int} amt - the amount of money to be transferred.
 * @param {String} note - The reason for the transaction
 */
const transferMoney = async (from, to, amt, note) => {
    console.log(`TRNS: Moving ${amt} from ${from} to ${to}.`);

    const newFromBalance = (await getBalance(from)) - amt;
    const newToBalance = (await getBalance(to)) + amt;

    if (newFromBalance < 0) {
        console.log(`Transfer failed - ${from} doesn't have enough money!`);
        throw 'InsufficientFundsError';
    }

    try {
        await setBalance(from, newFromBalance);
        await setBalance(to, newToBalance);
    } catch (err) {
        console.error(err);
        throw 'TransferError';
    }
    console.log(`Transfer complete!`);

    logTransaction(from, to, amt, note, true, undefined);
};

/**
 * Logs transactions to the "Ledger" table
 * @param {String} from | slack UID transfer from
 * @param {String} to | slack UID transfer to
 * @param {int} amount | transfer amount
 * @param {String} note | The note included with the transaction
 * @param {String} success | Whether or not the transaction was a success (?)
 * @param {String} logMessage | Admin note included with the transaction
 * @param {?} p | Legacy. Presently unused, but it has to exist in the airtable.
 */
const logTransaction = async (from, to, amount, note, success, logMessage) => {
    console.log(`INFO: Logging transfer to ledger.`);

    try {
        base('ledger')
            .create({
                From: from,
                To: to,
                Amount: amount,
                Note: note,
                Success: success,
                'Admin Note': logMessage,
                Timestamp: Date.now(),
                Private: false, //this is a legacy thing that just has to be maintained
            })
            .then((record) => {
                console.log(`Loged new transaction: ${record.getId()}`); //i know, a .then - but it works
            });
    } catch (err) {
        console.error(err);
        throw 'AirtableError';
    }
};

/**
 * Gathers pending invoices based on slack ID
 * @param {String} user | Slack UID for an individual user
 */
const getPendingInvoices = async (user) => {
    console.log(`Gathering pending invoices for ${user}.`);
    let inv;
    try {
        inv = await base('invoices')
            .select({
                filterByFormula: `AND(To = "${user}", {Status} = "Processing")`, // filters all invoices that are currently processing for that user
            })
            .all();
    } catch (err) {
        console.error(err);
        throw 'AirtableError';
    }

    return inv;
};

/**
 * Initializes an invoice in the airtable
 * @param {String} from | The user who initializes the invoice (and receives the money)
 * @param {String} to | The user who pays the invoice (and sends the money)
 * @param {String} reason | The reason for invoicing someone.
 * @param {int} amount | The amount they are invoiced
 */
const sendInvoice = async (from, to, reason, amount) => {
    console.log(
        `INVC: Creating invoice of ${amount} gp from ${from} to ${to}, for ${reason}.`
    );
    let inv;
    try {
        inv = await base('invoices').create({
            From: from,
            To: to,
            Reason: reason,
            Amount: amount,
            Status: 'Processing',
        });
    } catch (err) {
        console.error(err);
        throw 'AirtableError';
    }
    console.log(`INVC: Invoice Created.`);
};

/**
 * Gets an invoice based on said invoice ID
 * The invoice ID is available both as the `id` field on an airtable record object, and as a field 'InvoiceId' in in the table itself.
 * @param {String} invoiceId | Airtable record serving as UID for each invoice
 */
const getInvoiceById = async (invoiceId) => {
    console.log(`INFO: Gathering invoice  `);
    let inv;
    try {
        inv = await base('invoices')
            .select({ filterByFormula: `InvoiceId = "${invoiceId}"` })
            .all();
    } catch (err) {
        console.error(err);
        throw 'AirtableError';
    }
    return inv;
};

/**
 * Completes payment of an invoice, sending the money.
 * @param {String} invoiceId | Airtable record serving as UID for each invoice
 */
const payInvoice = async (invoiceId) => {
    console.log(`Processing invoice ID ${invoiceId}.`);
    try {
        let inv = await getInvoiceById(invoiceId);
        const rec = inv[0].fields;

        if (rec.Status === 'Paid') throw 'AlreadyPaid'; //in case someone uses pays on an already-paid instance

        await transferMoney(rec.To, rec.From, rec.Amount); //reverse to and from, since this is an invoice
        await base('invoices').update(invoiceId, {
            Status: 'Paid',
        }); //update record so it is now marked as paid
    } catch (err) {
        console.error(err);
        throw err;
    }
};

/**
 * Marks an invoice as denied in the airtable.
 * @param {String} invoiceId | Airtable record serving as UID
 */
const denyInvoice = async (invoiceId) => {
    try {
        await base('invoices').update(invoiceId, {
            Status: 'Denied',
        });
    } catch (err) {
        console.error(err);
        throw 'AirtableError';
    }
};

module.exports = {
    getBalance,
    transferMoney,
    logTransaction,
    getPendingInvoices,
    sendInvoice,
    payInvoice,
    denyInvoice,
};
