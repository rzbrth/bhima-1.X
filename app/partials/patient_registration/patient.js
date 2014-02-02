angular.module('kpk.controllers').controller('patientRegistration', function($scope, $q, $location, $modal, connect, validate, appstate) {
  var dependencies = {}, defaultBirthMonth = '06-01';
  $scope.patient = {}, $scope.data = {};
  
  dependencies.debtorGroup = { 
    query : {'tables' : {'debitor_group' : {'columns' : ['id', 'name', 'note']}}}
  };

  dependencies.village = { 
    query : { tables : { 'village' : { 'columns' : ['id', 'name'] }}}
  };

  dependencies.sector = { 
    query : { tables : { 'sector' : { 'columns' : ['id', 'name'] }}}
  };

  dependencies.province = { 
    query : { tables : { 'province' : { 'columns' : ['id', 'name'] }}}
  };

  dependencies.country = { 
    query : { tables : { 'country' : { 'columns' : ['id', 'country_en'] }}}
  };

  dependencies.location = { 
    query : { tables : { 'location' : { 'columns' : ['id', 'village_id', 'sector_id', 'country_id'] }}}
  };

  validate.process(dependencies).then(patientRegistration);

  function patientRegistration(model) { 
    $scope.model = model;
    // handlePatientImage();
  }
    
  function handlePatientImage() { 

    //FIXME This is super cheeky in angular - create a directive for this
    var video = document.querySelector('#patientImage'), patientResolution = { video : { mandatory : { minWidth: 300, maxWidth: 400 } } };
    
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;
    
    if (navigator.getUserMedia) {       
        navigator.getUserMedia(patientResolution, handleVideo, videoError);
    }
    
    function handleVideo(stream) {
        video.src = window.URL.createObjectURL(stream);
    }
    
    function videoError(error) {
      throw error;
    }
  }
  
  $scope.update = function(patient) {

    setLocation().then(function(locationId) {
      
      //TODO verify valid patient data
      patient.location_id = locationId; // Should this be in package_patient?
      
      commit(patient);
    });
  }

  function commit (patient) {


    var debtor = $scope.debtor;
    patient_model = patient;

    var format_debtor = {
      id: patient_model.debitor_id,
      group_id: $scope.debtor.debtor_group.id,
      text:patient_model.first_name+' - '+patient_model.last_name,
      convention_id : $scope.debtor.convention_id
    };
    //Create debitor record for patient - This SHOULD be done using an alpha numeric ID, like p12
    // FIXME 1 - default group_id, should be properly defined
    connect.basicPut("debitor", [format_debtor])
    .then(function(res) { 
      //Create patient record
      patient.debitor_id = res.data.insertId;
      connect.basicPut("patient", [patient_model])
      .then(function(res) {
        $location.path("invoice/patient/" + res.data.insertId);
        submitted = true;
      });
    });
  }
 
  //Location code - requires refactor + newer location schema
  $scope.selectLocation = function selectLocation () {
    $scope.data.oldLocaton = true;
  };

  $scope.$watch('data.village_id', function () {
    // reset the oldLocation flag if the model changes.
    $scope.data.oldLocation = false;
  });

  // TODO: Clean this code up.
  function setLocation () {
    var defer = $q.defer();

    // create location data if not exists
    var location_data;
    var data = $scope.data;
    if ($scope.data.oldLocation) {
      location_data = {
        country_id : data.country_id,
        province_id : data.province_id,
        sector_id : data.sector_id,
        village_id : data.village_id
      };

      connect.basicPut('location', [location_data])
      .then(function (result) {
        defer.resolve(result.data.insertId);
      }, function (error) {
        defer.reject(error);
      });

    } else {
      connect.basicPut('village', [{name: data.village_id}])
      .then(function (result) {
        console.log("result is:", result);
        var id = result.data.insertId;
        location_data = {
          country_id : data.country_id,
          province_id : data.province_id,
          sector_id : data.sector_id,
          village_id : id 
        };

        connect.basicPut('location', [location_data])
        .then(function (result) {
          defer.resolve(result.data.insertId);
        }, function (error) {
          defer.reject(error);
        });
      }); 
    }

    return defer.promise;
  }

  $scope.formatLocation = function(l) { 
    return l.city + ", " + l.region;
  };

  $scope.calcLocation = function (v) {
    $scope.data.newVillage = false;
    console.log("SINGLE:", v);
  };

  $scope.villageFilter = function (village) {
    var sector_id = $scope.data.sector_id;
    return $scope.model.location.data.some(function (l) {
      return l.sector_id === sector_id && l.village_id === village.id;
    });
  };

  $scope.formatTypeAhead = function () {
    return $scope.model ? $scope.model.village.get($scope.data.village_id).name : '';
  };
   
  //Utility methods
  $scope.$watch('sessionProperties.yob', function(nval) {
    if(nval && nval.length===4) $scope.patient.dob = nval + '-' + defaultBirthMonth;
	});

  //$().focus() would allow the page to flow better but is fairly cheeky in angular
  function enableFullDate() { $scope.sessionProperties.fullDateEnabled = true; }
  
  function checkChanged() { return angular.equals(model, $scope.master); }
    
  //Expose methods to scope
  $scope.enableFullDate = enableFullDate;
  $scope.checkChanged = checkChanged;
});
