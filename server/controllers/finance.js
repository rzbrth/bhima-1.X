// controllers/finance.js

var db = require('../lib/db'),
    guid = require('../lib/guid'),
    q = require('q');

// utilities

// TODO copied from journal.  These ought to be aggregated somewhere
function getTransactionId(projectId) {
  // get a new transaction id from the journal.
  // make sure it is the last thing fired in the
  // call stack before posting.
  var defer = q.defer();

  // FIXME
  // This can be done in one SQL with a default value
  // using an IF statement.  It will be much cleaner.

  var sql =
    'SELECT abbr, max(increment) AS increment FROM (' +
      'SELECT project.abbr, max(floor(substr(trans_id, 4))) + 1 AS increment ' +
      'FROM posting_journal JOIN project ON posting_journal.project_id = project.id ' +
      'WHERE posting_journal.project_id = ? ' +
    'UNION ' +
      'SELECT project.abbr, max(floor(substr(trans_id, 4))) + 1 AS increment ' +
      'FROM general_ledger JOIN project ON general_ledger.project_id = project.id ' +
      'WHERE general_ledger.project_id = ?)c;';

  var sql2 = 'SELECT project.abbr FROM project WHERE project.id = ?;';

  db.exec(sql, [projectId, projectId])
  .then(function (rows) {
    var data = rows.pop();

    // FIXME: dangerous test

    if (!data.abbr) {
      db.exec(sql2, [projectId])
      .then(function (rows){
        var data2 = rows.pop();
        value = String(data.increment ? data2.abbr + data.increment :  data2.abbr + 1);
        defer.resolve(value);
      })
      .catch(defer.reject);
    } else {
      var value = String(data.increment ? data.abbr + data.increment : data.abbr + 1);
      defer.resolve(value);
    }
  })
  .catch(defer.reject);

  return defer.promise;
}

// POST /journal/voucher
// Securely post a transaction to the posting journal.
//
// The steps involved are this:
//  1) Make sure the date is valid (not in the future)
//  2) Make sure the data sent from the client is valid (has valid totals, etc).
//  2a) Get the period_id, fiscal_year_id for the submitted date
//  2b) Validate the date isn't in the future
//  3) Check permissions and link the user with the registration
//  4) Exchange the values that need to be exchanged
//  5) Write to journal_log that a post happened
exports.postJournalVoucher = function (req, res, next) {
  'use strict';

  // error reporting FTW
  function report(errorText) {
    res.status(400).send(errorText);
  }

  var data = req.body.data,
      sql;

  /* validation checks */

  // turn into date object
  var date = new Date(data.date);

  // is the date in the future?
  if (date > new Date()) {

    // Send back"Bad Request" HTTP error code
    return report('ERR_DATE_IN_THE_FUTURE');
  }

  // validate that the rows balance
  var validAccounts = data.rows.every(function (row) {
    return row.account_id !== undefined;
  });

  if (!validAccounts) {
    return report('ERR_MISSING_ACCOUNTS');
  }

  // validate that the debits and credits balance
  var totals = data.rows.reduce(function (aggregate, row) {
    aggregate.debit += row.debit;
    aggregate.credit += row.credit;
    return aggregate;
  }, { debit : 0, credit : 0 });

  var validTotals = totals.debit.toFixed(4) === totals.credit.toFixed(4);

  if (!validTotals) {
    return report('ERR_DEBIT_CREDIT_IMBALANCE');
  }

  // Flatten the data object into a series of rows for
  // insertion into the database
  var dbrows = data.rows.map(function (row) {
    row.project_id = req.session.project_id;
    row.description = data.description;
    row.user_id = req.session.user.id;
    row.currency_id = data.currencyId;
    row.date = date;

    // strip the deb_cred_type if the deb_cred_uuid is undefined
    if (row.deb_cred_uuid === undefined) { row.deb_cred_type = undefined; }

    return row;
  });

  /* Begin gathering data for posting */

  // Let's get the fiscal year id and the period id for the given date
  sql =
    'SELECT period.id, period.fiscal_year_id ' +
    'FROM period JOIN fiscal_year ON ' +
      'period.fiscal_year_id = fiscal_year.id ' +
    'WHERE period.period_start < ? AND ' +
      'period.period_stop > ? AND ' +
      'fiscal_year.enterprise_id = ?;';

  db.exec(sql, [date, date, req.session.enterpriseId || 200])
  .then(function (rows) {

    // whoops! No period found!
    if (rows.length < 1) {
      throw 'ERR_NO_PERIOD';
    }

    // put the fiscal year and period id into the db rows
    var periodId = rows[0].id,
        fiscalYearId = rows[0].fiscal_year_id;

    dbrows.forEach(function (row) {
      row.fiscal_year_id = fiscalYearId;
      row.period_id = periodId;
    });

    // Okay, let's move on to exchange rate

    // If the currency is not the enterprise currency we need to
    // exchange the debits and credits.  Otherwise, do nothing.
    sql =
      'SELECT enterprise_currency_id, foreign_currency_id, rate ' +
      'FROM exchange_rate WHERE date = DATE(?);';

    return db.exec(sql, [date]);
  })
  .then(function (rows) {

    if (rows.length < 1) {
      throw 'ERR_NO_EXCHANGE_RATE';
    }

    // get the most recent record for that date
    // (if someone made a mistake, there may be multiple)
    // TODO Should this be fixed to one rate per currency per day?
    var record = rows.pop();


    // if we are not using the enterprise currency, we need to exchange the debits
    // and credits
    if (data.currencyId !== record.enterprise_currency_id) {

      // we are not using the enterprise currency.  Does the record's foreign_curreny_id
      // match our currency we are trying to post? (it should, unless we use more than three currencies.)
      if (data.currencyId !== record.foreign_currency_id) {

        // didn't find a suitable exchange rate, throw an error
        throw 'ERR_NO_EXCHANGE_RATE';
      }

      // we are exchanging the data using the exchange rate.
      dbrows.forEach(function (row) {
        row.debit_equiv = row.debit * (1 / record.rate);
        row.credit_equiv = row.credit * (1 / record.rate);
      });

    // we are using the enterprise currency.  Just transfer the debits and credits
    } else {

      // we are exchanging the data using the exchange rate.
      dbrows.forEach(function (row) {
        row.debit_equiv = row.debit;
        row.credit_equiv = row.credit;
      });
    }

    return getTransactionId(req.session.project_id);
  })

  // FIXME We need to stop depending on this async transId function
  .then(function (transId) {

    sql =
      'INSERT INTO posting_journal ' +
        '(uuid, project_id, fiscal_year_id, period_id, trans_id, trans_date, ' +
        'description, account_id, credit, debit, credit_equiv, debit_equiv, ' +
        'currency_id, deb_cred_uuid, deb_cred_type, inv_po_id, origin_id, user_id, pc_id, cc_id) ' +
      'VALUES ?;';

    // node-mysql accepts an array of arrays for bulk inserts.
    // we should shape our data to fit the standard it is looking to see.
    var insertRows = dbrows.map(function (row) {
      return [
        guid(),
        row.project_id,
        row.fiscal_year_id,
        row.period_id,
        transId,
        row.date,
        row.description,
        row.account_id,
        row.credit,
        row.debit,
        row.credit_equiv,
        row.debit_equiv,
        row.currency_id,
        row.deb_cred_uuid,
        row.deb_cred_type,
        row.inv_po_id,
        5, // FIXME: What is the origin id actually supposed to be?
        row.user_id,
        row.pc_id,
        row.cc_id
      ];
    });

    return db.exec(sql, [insertRows]);
  })
  .then(function () {
    res.status(200).send('POST_SUCCESSFUL');
  })
  .catch(function (error) {
    res.status(400).send(error);
  });
};


// GET /finance/debtors
// returns a list of debtors
exports.getDebtors = function (req, res, next) {
  'use strict';

  var sql =
    'SELECT d.uuid, d.text, CONCAT(p.first_name, p.middle_name, p.last_name) AS patientname, ' +
      'dg.name AS groupname, a.id AS account_id, a.account_number ' +
    'FROM debitor AS d JOIN patient AS p JOIN debitor_group AS dg JOIN account AS a ON ' +
      'd.uuid = p.debitor_uuid AND d.group_uuid = dg.uuid AND dg.account_id = a.id;';

  db.exec(sql)
  .then(function (rows) {
    res.status(200).json(rows);
  })
  .catch(function (error) {
    next(error);
  })
  .done();
};

// GET /finance/creditors
exports.getCreditors = function (req, res, next) {
  'use strict';

  var sql =
    'SELECT c.uuid, c.text, cg.name, c.group_uuid, a.id AS account_id, a.account_number ' +
    'FROM creditor AS c JOIN creditor_group AS cg JOIN account AS a ' +
      'ON c.group_uuid = cg.uuid AND cg.account_id = a.id;';

  db.exec(sql)
  .then(function (rows) {
    res.status(200).json(rows);
  })
  .catch(function (error) {
    next(error);
  })
  .done();
};

// GET /finance/currencies
exports.getCurrencies = function (req, res, next) {
  'use strict';

  var sql =
    'SELECT c.id, c.name, c.symbol, c.decimal, c.separator, c.note ' +
    'FROM currency AS c;';

  db.exec(sql)
  .then(function (rows) {
    res.status(200).json(rows);
  })
  .catch(function (error) {
    next(error);
  })
  .done();
};

// GET /finance/costcenters
exports.getCostCenters = function (req, res, next) {
  'use strict';

  var sql =
    'SELECT project_id, id, text FROM cost_center;';

  db.exec(sql)
  .then(function (rows) {
    res.status(200).json(rows);
  })
  .catch(function (error) {
    next(error);
  })
  .done();
};


// GET /finance/profitcenters
exports.getProfitCenters = function (req, res, next) {
  'use strict';

  var sql =
    'SELECT project_id, id, text FROM profit_center;';

  db.exec(sql)
  .then(function (rows) {
    res.status(200).json(rows);
  })
  .catch(function (error) {
    next(error);
  })
  .done();
};