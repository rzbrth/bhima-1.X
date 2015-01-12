angular.module('bhima.controllers')
.controller('reportCashPayments', [
  '$scope',
  '$timeout',
  'connect',
  'appstate',
  'validate',
  'exchange',
  function ($scope, $timeout, connect, appstate, validate, exchange) {
    var session = $scope.session = {};
    $scope.selected = null;

    var dependencies = {};
    dependencies.projects = {
      required: true,
      query : {
        tables : {
          'project' : {
            columns : ['id', 'abbr', 'name']
          }
        }
      }
    };

    function day () {
      session.dateFrom = new Date();
      session.dateTo = new Date();
      reset();
    }

    function week () {
      session.dateFrom = new Date();
      session.dateTo = new Date();
      session.dateFrom.setDate(session.dateTo.getDate() - session.dateTo.getDay());
      reset();
    }

    function month () {
      session.dateFrom = new Date();
      session.dateTo = new Date();
      session.dateFrom.setDate(1);
      reset();
    }


    dependencies.currencies = {
      required : true,
      query : {
        tables : {
          'currency' : {
            columns : ['id', 'symbol']
          }
        }
      }
    };

    $scope.options = [
      {
        label : 'CASH_PAYMENTS.DAY',
        fn : day,
      },
      {
        label : 'CASH_PAYMENTS.WEEK',
        fn : week,
      },
      {
        label : 'CASH_PAYMENTS.MONTH',
        fn : month
      }
    ];

    function search (selection) {
      session.selected = selection.label;
      selection.fn();
    }

    function reset (p) {
      session.searching = true;
      var req, url;

      // toggle off active
      session.active = !p;

      req = {
        dateFrom : session.dateFrom,
        dateTo : session.dateTo
      };

      url = '/reports/payments/?id=%project%&start=%start%&end=%end%'
      .replace('%project%', session.project)
      .replace('%start%', req.dateFrom)
      .replace('%end%', req.dateTo);

      connect.fetch(url)
      .then(function (model) {
        if (!model) { return; }
        $scope.payments = model;
        $timeout(function () {
          convert();
          session.searching = false;
        });
      });

    }

    appstate.register('project', function (project) {
      session.project = project.id;
      validate.process(dependencies)
      .then(function (models) {
        $scope.projects = models.projects;
        $scope.currencies = models.currencies;
        session.currency = $scope.currencies.data[0].id;
        $scope.allProjectIds =
          models.projects.data.reduce(function (a,b) { return a + ',' + b.id ; }, '')
          .substr(1);
        search($scope.options[0]);
      });
    });

    appstate.register('enterprise', function (enterprise) {
      $scope.enterprise = enterprise; 
    });    

    function convert () {
      var s = 0;
      var sum_convert = 0;
      $scope.payments.forEach(function (payment) {
        if($scope.enterprise.currency_id !== payment.currency_id){
          var convert = payment.cost / exchange.rate(payment.cost, payment.currency_id,new Date());  
          s += convert;
        } else {
          s += payment.cost; 
        }

        if ($scope.enterprise.currency_id === session.currency) {
          sum_convert = s; 
        } else {
          sum_convert = s * exchange.rate(payment.cost,session.currency,new Date());
        }
      });
      session.sum = sum_convert;
    }

    $scope.$watch('payments', function () {
      if (!$scope.payments) { return; }
      var unique = [];
      $scope.payments.forEach(function (payment) {
        if (unique.indexOf(payment.deb_cred_uuid) < 0) {
          unique.push(payment.deb_cred_uuid);
        }
      });

      session.unique_debitors = unique.length;
    }, true);

    $scope.search = search;
    $scope.reset = reset;
    $scope.convert = convert;
  }
]);
