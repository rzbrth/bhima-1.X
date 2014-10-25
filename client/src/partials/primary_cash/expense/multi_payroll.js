angular.module('bhima.controllers')
.controller('multi_payroll', [
  '$scope',
  '$routeParams',
  '$translate',
  '$http',
  'messenger',
  'validate',
  'appstate',
  'connect',
  '$location',
  'util',
  'appcache',
  'exchange',
  '$q',
  'ipr',
  'uuid',
  function ($scope, $routeParams, $translate, $http, messenger, validate, appstate, connect, $location, util, Appcache, exchange, $q, ipr, uuid) {
    var dependencies = {},
        cache = new Appcache('payroll'),
        session = $scope.session = {configured : false, complete : false, data : {}, selectedItem : {}, rows : []};

    session.cashbox = $routeParams.cashbox;

    dependencies.cash_box = {
      required : true,
      query : {
        tables : {
          'cash_box_account_currency' : {
            columns : ['id', 'currency_id', 'account_id']
          },
          'currency' : {
            columns : ['symbol', 'min_monentary_unit']
          },
          'cash_box' : {
            columns : ['id', 'text', 'project_id']
          }
        },
        join : [
          'cash_box_account_currency.currency_id=currency.id',
          'cash_box_account_currency.cash_box_id=cash_box.id'
        ],
        where : [
          'cash_box_account_currency.cash_box_id=' + session.cashbox
        ]
      }
    };

    dependencies.exchange_rate = {
      required : true,
      query : {
        tables : {
          'exchange_rate' : {
            columns : ['id', 'enterprise_currency_id', 'foreign_currency_id', 'date', 'rate']
          }
        },
        where : ['exchange_rate.date='+util.sqlDate(new Date())]
      }
    };

    dependencies.employees = {
      required : true,
      query : 'employee_list/'
    };

    dependencies.cashier = {
      query : 'user_session'
    };

    dependencies.paiement_period = {
      query : {
        tables : {
          'paiement_period' : {
            columns : ['id', 'config_tax_id', 'config_rubric_id', 'label', 'dateFrom', 'dateTo']
          }
        }
      }
    };

    dependencies.pcash_module = {
      required : true,
      query : {
        tables : {
          'primary_cash_module' : {
            columns : ['id']
          }
        },
        where : ['primary_cash_module.text=Payroll']
      }
    };

    dependencies.enterprise = {
      query : {
        tables : {
          'enterprise' : {
          columns : ['currency_id']
        }
        }
      }
    };

    dependencies.paiements = {
      query : {
        tables : {
          'paiement' : {
            columns : ['uuid', 'employee_id']
          }
        }        
      }
    };

    appstate.register('project', function (project) {
      $scope.project = project;               
        validate.process(dependencies, ['enterprise', 'pcash_module', 'paiement_period', 'cashier', 'exchange_rate', 'cash_box'])
        .then(init, function (err) {
          messenger.danger(err.message + ' ' + err.reference);           
        });     
    });

    function reconfigure() {
      cache.remove('paiement_period');
      session.pp = null;
      session.configured = false;
      session.complete = false;
    } 

    function init (model) {
      session.model = model; 
      cache.fetch('selectedItem')
      .then(function (selectedItem){
        if (!selectedItem) { throw new Error('Currency undefined'); }
        session.loading_currency_id = selectedItem.currency_id;
        session.selectedItem = selectedItem;
        return cache.fetch('paiement_period');
      })
      .then(function (pp) {
        if(!pp) {
          throw new Error('Paiement period undefined');
        }
        session.pp = pp; 
        dependencies.paiements.query.where = ['paiement.paiement_period_id=' + session.pp.id];
        if(dependencies.paiements) {
          dependencies.paiements.processed = false;
        }

        if(dependencies.employees){
          dependencies.employees.processed = false;
        }
        
             
        return validate.process(dependencies, ['employees', 'paiements']);
      })
      .then(function (model) {
        session.model = model;
        session.configured = true;
        session.complete = true;
        return getPPConf();
      })
      .then(getOffDayCount)
      .then(getTrancheIPR)
      .then(function(tranches){
         session.tranches_ipr = tranches;
      })
      .then(getEmployees)
      .catch(function (err) {
        messenger.danger(err.message);
        console.log('err', err);
      });
    }

    function getEmployees () {
      session.rows = [];     
      var unpaidEmployees = getUnpaidEmployees();
      unpaidEmployees.forEach(function (emp) {
        new EmployeeRow(emp)
        .then(function (row) {      
          session.rows.push(row);
        }); 
      });
    }

    function getUnpaidEmployees () {
      return session.model.employees.data.filter(function (emp) {
        var pass = session.model.paiements.data.some(function (paiement) {
          return paiement.employee_id === emp.id;
        });
        return !pass;
      });
    }

    function refreshList () {
      return session.rows.filter(function (row) {
        var pass = session.model.paiements.data.some(function (paiement) {
          return paiement.employee_id === row.emp.id;
        });
        return !pass;
      });
    }

    function EmployeeRow (emp) {
      var self = this;
      var def = $q.defer();      
      getHollyDayCount(emp)
      .then(function (hl){
        self.hollyday = hl;
        self.off_day = session.data.off_day;
        self.emp = emp;
        self.emp.basic_salary = 
        exchange.convertir(
          self.emp.basic_salary,
          session.model.enterprise.data[0].currency_id,
          session.selectedItem.currency_id,
          util.sqlDate(new Date())
        );
        self.max_day = session.data.max_day;

        /*if(session.data.max_day === hl){
          hl -= session.data.off_day;
          self.hollyday = hl; 
        }*/
        self.working_day = session.data.max_day - (hl + session.data.off_day);
        console.log('Nomb jour Max',session.data.max_day);
        console.log('Jour ferie',session.data.off_day);
        console.log('Jour ferie dans l application',hl);
        console.log('Working Days',self.working_day);

        self.hollydays = hl;
        self.offdays = session.data.off_day;
        self.daily_salary = self.emp.basic_salary / session.data.max_day;
        self.ALLO = 0;
        self.TRAN = 0;
        self.SENI = 0;
        self.ADVA = 0;
        self.other = 0;
        self.ONEM = 0;
        self.INPP = 0;
        self.IERE = 0;       
        self.visible = false;
        return getHousing(self);        
      })
      .then(function (hous) {
        self.HOUS = hous;
        return getEmployeeINSS(self);
      })
      .then(function (employee_INSS) {
        self.INS1 = employee_INSS;
        self.net_before_taxe = ((self.working_day + self.hollydays + self.offdays) * self.daily_salary) - self.INS1;       
        return getIPR(self);        
      })
      .then(function (IPR){
        self.IPR1 = IPR;        
        return getEnterpriseINSS(self);        
      })
      .then(function (enterprise_INSS){
        self.INS2 = enterprise_INSS;
        self.offdays_cost = getOffDayCost(self);
        def.resolve(self);
      });
      return def.promise;
    }

    function getIPR(row) {
      var tranches = session.tranches_ipr;
      if(!tranches.length) {return 0;}

      var net_imposable = exchange.convertir(
        row.net_before_taxe,
        session.selectedItem.currency_id,                                                                    
        tranches[0].currency_id,                 
        util.sqlDate(new Date())
      );


      var montant_annuel = net_imposable * 12;

      var ind = -1;
      for(var i = 0; i< tranches.length; i++) {
        if(montant_annuel > tranches[i].tranche_annuelle_debut && montant_annuel < tranches[i].tranche_annuelle_fin) {
          ind = i;
          break;
        }
      }


      if(ind < 0) { return 0; }
      var initial = tranches[ind].tranche_annuelle_debut;
      var taux = tranches[ind].taux / 100;

      var cumul = (tranches[ind - 1]) ? tranches[ind - 1].cumul_annuel : 0;
      var value = (((montant_annuel - initial) * taux) + cumul) / 12;

      if(row.emp.nb_enfant > 0) {
        value -= (value * (row.emp.nb_enfant * 2)) / 100;
      }

      return exchange.convertir(value, tranches[0].currency_id, session.selectedItem.currency_id, util.sqlDate(new Date()));
    }

    function getOffDayCost (row) {
      var cost = 0;
      session.model.offDays.data.forEach(function (offday) {
        cost = cost + (row.daily_salary * offday.percent_pay) / 100;
      });
      return cost;
    }

    function getPPConf() {

      dependencies.paiement_period_conf = {
        required : true,
        query : {
          tables : {
            'config_paiement_period' : {
              columns : ['id', 'weekFrom', 'weekTo']
            }
          },
          where : ['config_paiement_period.paiement_period_id=' + session.pp.id]
        }
      };

      dependencies.rubric_config = {
        required : true,
        query : {
          tables : {
            'config_rubric' : {
              columns : ['label']
            },
            'config_rubric_item' : {
              columns : ['rubric_id', 'payable']
            },
            'rubric' : {
              columns : ['id', 'abbr', 'is_percent', 'is_discount', 'value']
            }
          },
          join : [
            'config_rubric.id=config_rubric_item.config_rubric_id',
            'rubric.id=config_rubric_item.rubric_id'
          ],
          where : [
            'config_rubric.id=' + session.pp.config_rubric_id
          ]
        }
      };

      dependencies.tax_config = {
        required : true,
        query : {
          tables : {
            'config_tax' : {
              columns : ['label']
            },
            'config_tax_item' : {
              columns : ['tax_id', 'payable']
            },
            'tax' : {
              columns : ['id', 'abbr', 'is_percent', 'value', 'account_id']
            }
          },
          join : [
            'config_tax.id=config_tax_item.config_tax_id',
            'tax.id=config_tax_item.tax_id'
          ],
          where : [
            'config_tax.id=' + session.pp.config_tax_id
          ]
        }
      };

      return validate.process(dependencies, ['paiement_period_conf', 'rubric_config', 'tax_config']);
    }

    function getOffDayCount (model) {
      session.model = model;
      
      dependencies.offDays = {
        query : {
          tables : {
            'offday' : {
              columns : ['id', 'label', 'date', 'percent_pay']
            }
          },
          where : ['offday.date>=' + util.sqlDate(session.pp.dateFrom), 'AND', 'offday.date<=' + util.sqlDate(session.pp.dateTo)]
        }
      };     
      validate.process(dependencies, ['offDays'])
      .then(function (model) {
        console.log('Pas des probleme dans cette base de donnees');
        var offdays = model.offDays.data;
        var pp_confs = model.paiement_period_conf.data;
        var nb_offdays = 0;
        //console.log('Periode Configurer',pp_confs);
        session.data.max_day = getMaxDays(pp_confs);
        offdays.forEach(function (offDay) {
          for(var i = 0; i < pp_confs.length; i++){
            if ((util.isDateAfter(offDay.date, pp_confs[i].weekFrom) || util.areDatesEqual(offDay.date, pp_confs[i].weekFrom)) &&
                (util.isDateAfter(pp_confs[i].weekTo, offDay.date) || util.areDatesEqual(offDay.date, pp_confs[i].weekTo))) {
              nb_offdays++;
            }
          }
        });

        session.data.offdays = offdays;
        session.data.off_day = nb_offdays;
      });
      return $q.when();
    }

    function getTrancheIPR () {
      return ipr.calculate();
    }

    function getMaxDays (ppcs) {
      var nb = 0;
      ppcs.forEach(function (item) {
        //console.log(new Date(item.weekTo).getDate(),'et',new Date(item.weekFrom).getDate());

        var t2 = new Date(item.weekTo).getTime();
        var t1 = new Date(item.weekFrom).getTime();

        nb += (parseInt((t2-t1)/(24*3600*1000))) + 1;

        });

      return nb;
    }

    function getHollyDayCount (employee) {
      var defer = $q.defer();
      var som = 0;
      // var pp = session.model.paiement_period.data[0];
      var pp = session.pp;
 
      connect.fetch('/hollyday_list/' + JSON.stringify(pp) + '/' + employee.id)
      .then(function (res) {
        var hollydays = res;
        if(hollydays.length) {
          var pp_confs = session.model.paiement_period_conf.data;
          var soms = [];

          hollydays.forEach(function (h) {
            var nb = 0,
                nbOf = 0;
            
            function getValue (ppc) {
              //paiement period config === ppc
              var date_pweekfrom = new Date(ppc.weekFrom);
              var date_pweekto = new Date(ppc.weekTo);

              var date_hdatefrom = new Date(h.dateFrom);
              var date_hdateto = new Date(h.dateTo);
              var nbOff = 0;

              var num_pweekfrom = date_pweekfrom.setHours(0,0,0,0);
              var num_pweekto = date_pweekto.setHours(0,0,0,0);

              var num_hdatefrom = date_hdatefrom.setHours(0,0,0,0);            
              var num_hdateto = date_hdateto.setHours(0,0,0,0);

              var minus_right = 0, minus_left = 0;

              if(num_pweekto > num_hdateto){
                minus_right = date_pweekto.getDate() - date_hdateto.getDate();
              }

              if(num_pweekfrom < num_hdatefrom){
                minus_left = date_hdatefrom.getDate() - date_pweekfrom.getDate();
              }

              //console.log('Le nombre total de Offdays:',session.data.offdays.length);
              var nbOffDaysPos = 0; 
              for(var i = 0; i < session.data.offdays.length; i++){
                var dateOff = new Date(session.data.offdays[i].date);
                var num_dateOff = dateOff.setHours(0,0,0,0);
                //console.log(util.sqlDate(dateOff),util.sqlDate(date_pweekfrom),util.sqlDate(date_pweekto));
                if(((num_dateOff >= num_hdatefrom) && (num_dateOff <= num_hdateto)) && 
                  ((num_dateOff >= num_pweekfrom) && (num_dateOff <= num_pweekto))){
                  nbOffDaysPos++;
                }
              }

              var total = date_pweekto.getDate() - date_pweekfrom.getDate() + 1 - nbOffDaysPos;
              if(minus_left > total) { return 0; }
              if(minus_right > total) { return 0; } 
              return total - (minus_left + minus_right);
            }

            pp_confs.forEach(function (ppc) {
              nb += getValue(ppc);
              
            });


            
            soms.push(nb);
          });

          som = soms.reduce(function (x, y){
            return x+y;
          }, 0);

          defer.resolve(som); 
        }else{
          defer.resolve(0);
        }               
      });
      return defer.promise;
    }

    function getHousing (row) {
      var rubrics = session.model.rubric_config.data, housing = 0;

      if(!rubrics.length){
        return $q.when(housing);
      } 

      var item = rubrics.filter(function (item) {
        return item.abbr === 'HOUS';
      })[0];

      if(item) {
        housing = (item.is_percent) ? 
        ((row.daily_salary * (row.working_day + row.hollydays + row.offdays)) * item.value) / 100 : item.value;    
      }
      return $q.when(housing);      
    }

    function getEmployeeINSS (row) {
      var taxes = session.model.tax_config.data, employee_inss = 0;
      if(!taxes.length) {

        return $q.when(employee_inss);
      }

      var item = taxes.filter(function (item) {
        return item.abbr === 'INS1';
      })[0];

      if(item) {
        employee_inss = (item.is_percent) ? 
        ((row.daily_salary * (row.working_day + row.hollydays + row.offdays)) * item.value) / 100 : item.value;    
      }
      return $q.when(employee_inss);      
    }

    function getEnterpriseINSS (row) {
      var taxes = session.model.tax_config.data, enterprise_inss = 0;

      if(!taxes.length) {
        return $q.when(enterprise_inss);
      }

      var item = taxes.filter(function (item) {
        return item.abbr === 'INS2';
      })[0];

      if(item) {
        enterprise_inss = (item.is_percent) ? 
        ((row.daily_salary * (row.working_day + row.hollydays + row.offdays)) * item.value) / 100 : item.value;    
      }
      return $q.when(enterprise_inss);      
    }


    function setCashAccount(cashAccount) {
      if (cashAccount) {
        session.loading_currency_id = session.selectedItem.currency_id || session.model.enterprise.data[0].currency_id;
        var reload = session.selectedItem.currency_id ? false : true;
        session.selectedItem = cashAccount;        
        cache.put('selectedItem', cashAccount);
        if(reload){
          init(session.model);
        }
      }
    }

    function initialiseEmployee (selectedEmployee) {
      session.data.working_day = 0;
      session.data.fam_allow = 0;
      session.data.transport = 0;
      session.data.seniority = 0;
      getHollyDayCount(session.model)
      .then(getHousing);
    }

    function formatPeriod (pp) {
      return [pp.label, util.sqlDate(pp.dateFrom), util.sqlDate(pp.dateTo)].join(' / ');
    }

    function setConfiguration (pp) {
      if(pp){
        cache.put('paiement_period', pp);
        session.configured = true;
        session.pp = pp;
        session.complete = true;
        init(session.model);
      }            
    }

    function payEmployee (packagePay) {
      var def = $q.defer();

      connect.basicPut('paiement', [packagePay.paiement], ['uuid'])
        .then(function () {
          return connect.basicPut('primary_cash', [packagePay.primary], ['uuid']);
        })
        .then(function () {
          return connect.basicPut('primary_cash_item', [packagePay.primary_details], ['uuid']);
        })
        .then(function () {
          return connect.basicPut('rubric_paiement', packagePay.rc_records, ['id']);
        })
        .then(function () {
          return connect.basicPut('tax_paiement', packagePay.tc_records, ['id']);
        })
        .then(function () {
          return connect.fetch('/journal/payroll/' + packagePay.primary.uuid);
        })
        .then(function (res){
          def.resolve(res);
        })
        .catch(function (err){
          def.reject(err);
        });

        return def.promise;
    }

    function submit (list) {
      var rubric_config_list = session.model.rubric_config.data;
      var tax_config_list = session.model.tax_config.data;

      return $q.all(list.map(function (elmt) {
        var rc_records = [];
        var tc_records = [];        
        //elmt.net_after_taxe = elmt.net_before_taxe - elmt.IPR1 - elmt.ONEM - elmt.IERE - elmt.INPP;
        elmt.net_after_taxe = elmt.net_before_taxe - elmt.IPR1;

        elmt.net_salary = elmt.net_after_taxe + (elmt.HOUS + elmt.TRAN + elmt.ALLO + elmt.SENI - (elmt.ADVA + (elmt.daily_salary * elmt.off_day))) + elmt.offdays_cost; 
        var paiement = {
          uuid : uuid(),
          employee_id : elmt.emp.id,
          paiement_period_id : session.pp.id,
          currency_id : session.selectedItem.currency_id,
          paiement_date : util.sqlDate(new Date()),
          working_day : elmt.working_day,
          net_before_tax : elmt.net_before_taxe,
          net_after_tax : elmt.net_after_taxe,          
          net_salary : elmt.net_salary
        };

        rubric_config_list.forEach(function (rc) {
          var record = {
            paiement_uuid : paiement.uuid,
            rubric_id : rc.id,
            value : elmt[rc.abbr]
          };
          rc_records.push(record);
        });
          
        tax_config_list.forEach(function (tc) {
          var record = {
            paiement_uuid : paiement.uuid,
            tax_id : tc.id,
            value : elmt[tc.abbr],
            posted : 0
          };
          tc_records.push(record);
        });

        var primary = {
          uuid          : uuid(),
          project_id    : $scope.project.id,
          type          : 'S',
          date          : util.sqlDate(new Date()),
          deb_cred_uuid : elmt.emp.creditor_uuid,
          deb_cred_type : 'C',
          account_id    : session.selectedItem.account_id,
          currency_id   : session.selectedItem.currency_id,
          cost          : paiement.net_salary,
          user_id       : session.model.cashier.data.id,
          description   : 'Payroll : ' + elmt.emp.name + elmt.emp.postnom,
          cash_box_id   : session.cashbox,
          origin_id     : 6
        };

        var primary_details = {
          uuid              : uuid(),
          primary_cash_uuid : primary.uuid,
          debit             : 0,
          credit            : primary.cost,
          document_uuid     : paiement.uuid
        };

        var packagePay = {
          paiement : paiement,
          primary : primary,
          primary_details : primary_details,
          rc_records : rc_records,
          tc_records : tc_records
        };

        var def = $q.defer();
        payEmployee(packagePay)
        .then(function (val) {
          def.resolve(val);
        });
        return def.promise;
      }))
      .then(function (tab) {
        messenger.success('success');
        validate.refresh(dependencies, ['paiements'])
        .then(function () {
          session.rows = refreshList();
        });
      })
      .catch(function (err) {
        messenger.danger(err);
      });
    }

    function refresh(row){
      var totaldays = row.working_day + row.hollydays + row.offdays; 
      if(!row.working_day){
        row.working_day = 0;
      }

      if((row.working_day) && (totaldays <= row.max_day)){
        getEmployeeINSS(row)
        .then(function (val) {
          row.INS1 = val;
          row.net_before_taxe = ((row.working_day + row.hollydays + row.offdays) * row.daily_salary) - row.INS1; 
          var IPR = getIPR(row);
          row.IPR1 = IPR;
        });   

        getEnterpriseINSS(row)
        .then(function (val) {
          row.INS2 = val;
        });   

        getHousing(row)
        .then(function (val) {
          row.HOUS = val;
        });

      } else if (totaldays > row.max_day) {
        messenger.danger($translate.instant('RUBRIC_PAYROLL.NOT_SUP_MAXDAY'));  
        row.working_day = 0;
        getEmployeeINSS(row)
        .then(function (val) {
          row.INS1 = val;
          row.net_before_taxe = ((row.working_day + row.hollydays + row.offdays) * row.daily_salary) - row.INS1;
          var IPR = getIPR(row);
          row.IPR1 = IPR;
        });        

        getEnterpriseINSS(row)
        .then(function (val) {
          row.INS2 = val;
        }); 

        getHousing(row)
        .then(function (val) {
          row.HOUS = val;
        });   

      } 
    }

    $scope.$watch('session.selectedItem', function (nval, oval) {

       if(session.rows.length) {
          session.rows.forEach(function (row) {
            row.emp.basic_salary = 
              exchange.convertir(
                row.emp.basic_salary,
                session.loading_currency_id,
                session.selectedItem.currency_id,
                util.sqlDate(new Date())
            );

            row.daily_salary = 
              exchange.convertir(
                row.daily_salary,
                session.loading_currency_id,
                session.selectedItem.currency_id,
                util.sqlDate(new Date())
            );   

            row.HOUS = exchange.convertir(
              row.HOUS,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            );

            row.INS1 = exchange.convertir(
              row.INS1,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            ); 

            row.INS2 = exchange.convertir(
              row.INS2,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            );

            row.IPR1 = exchange.convertir(
              row.IPR1,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            );

            row.ALLO = exchange.convertir(
              row.ALLO,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            );

            row.SENI = exchange.convertir(
              row.SENI,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            );

            row.ADVA = exchange.convertir(
              row.ADVA,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            );

            row.TRAN = exchange.convertir(
              row.TRAN,
              session.loading_currency_id,
              session.selectedItem.currency_id,
              util.sqlDate(new Date())
            );


            row.net_before_taxe = 
              exchange.convertir(
                row.net_before_taxe,
                session.loading_currency_id,
                session.selectedItem.currency_id,
                util.sqlDate(new Date())
            );

            row.net_after_taxe = 
              exchange.convertir(
                row.net_after_taxe,
                session.loading_currency_id,
                session.selectedItem.currency_id,
                util.sqlDate(new Date())
            );

            row.offdays_cost = 
              exchange.convertir(
                row.offdays_cost,
                session.loading_currency_id,
                session.selectedItem.currency_id,
                util.sqlDate(new Date())
            );

            row.net_salary = 
              exchange.convertir(
                row.net_salary,
                session.loading_currency_id,
                session.selectedItem.currency_id,
                util.sqlDate(new Date())
            );
          });
        }     
    }, true);

    $scope.setCashAccount = setCashAccount;  
    $scope.initialiseEmployee = initialiseEmployee; 
    $scope.formatPeriod = formatPeriod;
    $scope.setConfiguration = setConfiguration;
    $scope.reconfigure = reconfigure;
    $scope.submit = submit;
    $scope.refresh = refresh;
  }
]);
