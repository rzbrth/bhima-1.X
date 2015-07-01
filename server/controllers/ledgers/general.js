
var db = require('../../lib/db');

/** queries the general ledger for all columns */
// route: /ledgers/general
exports.route = function (req, res, next) {
  'use strict';
  var sql;
 
  sql =
    'SELECT gl.uuid, gl.fiscal_year_id, gl.period_id, gl.trans_id, gl.trans_date, gl.doc_num, gl.description, ' +
      'gl.account_id, gl.debit, gl.credit, gl.debit_equiv, gl.credit_equiv, gl.currency_id, gl.deb_cred_uuid, ' +
      'gl.deb_cred_type, gl.inv_po_id, gl.comment, gl.cost_ctrl_id, gl.origin_id, gl.user_id, acc.account_number ' + 
    'FROM general_ledger AS gl JOIN account AS acc ' +
      'ON gl.account_id = acc.id ' +
    'ORDER BY gl.trans_date;';

  db.exec(sql)
  .then(function (rows) {
    res.send(rows);
  })   
  .catch(next)
  .done();
};
