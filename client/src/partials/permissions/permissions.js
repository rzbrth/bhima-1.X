// This module is responsible for handling the creation
// of users and assigning permissions to existing modules.

// TODOs:
// - Password Insecure alert or not
// - Rewrite this controller to use
//   1) Controller As syntax
//   2) Angular Form Validation
angular.module('bhima.controllers')
.controller('PermissionsController', PermissionsController);

PermissionsController.$inject = [
  '$window', '$translate', '$http', '$modal', 'util', 'SessionService', 'UserService',
  'ProjectService', 'NodeTreeService'
];

function PermissionsController($window, $translate, $http, $modal, util, Session, Users, Projects, NT) {
  var vm = this;
  var btnTemplate =
    '<button ng-click="grid.appScope.edit(row.entity)">{{ "FORM.EDIT" | translate }}</button>' +
    '<button ng-click="grid.appScope.editPermissions(row.entity)">{{ "PERMISSIONS.EDIT_PERMISSIONS" | translate }}</button>';

  // options for the UI grid
  vm.uiGridOptions = {
    appScopeProvider : vm, // ensure that the controller's `this` variable is bound to appScope
    columnDefs : [
      { field : 'displayname', name : 'Display Name' },
      { field : 'username', name : 'User Name' },
      { name : 'Actions', cellTemplate: btnTemplate }
    ],
    enableSorting : true
  };

  // the user object that is either edited or created
  vm.user = {};

  // TODO -- manage state without strings
  vm.state = 'default'; // this is default || create || update

  // bind methods
  vm.setState = setState;
  vm.submit = submit;
  vm.validPassword = validPassword;
  vm.edit = edit;
  vm.editPermissions = editPermissions;
  vm.setPasswordModal = setPasswordModal;
  vm.checkboxOffset = checkboxOffset;
  vm.toggleUnitChildren = toggleUnitChildren;
  vm.toggleSuperUserPermissions = toggleSuperUserPermissions;

  /* ------------------------------------------------------------------------ */

  // TODO
  function handler(error) {
    throw error;
  }

  // sets the module view state
  function setState(state) {
    vm.state = state;
    vm.super = 0; // reset super user determination between states
    vm.user = {}; // reset users between state changes
  }

  // this is the new user
  function edit(user) {

    // load the user
    Users.read(user.id)
    .then(function (user) {
      setState('update');
      vm.user = user;
    })
    .catch(handler)
    .finally();
  }

  function editPermissions(user) {

    var units;

    // load the tree units
    loadUnits()
    .then(function (data) {

      // unit value comparison function
      function cmp(nodeA, nodeB) {
        var a = $translate.instant(nodeA.key);
        var b = $translate.instant(nodeB.key);
        return a > b ? 1 : -1;
      }

      // build tree before flattening
      var tree = NT.buildNodeTree(data);
      units = NT.flattenInPlace(tree, cmp);

      // make sure that we have the proper permissions selected
      return Users.permissions(user.id);
    })
    .then(function (permissions) {

      // loop through units, giving permissions in line with those in the
      // database
      permissions.forEach(function (object) {
        units.forEach(function (unit) {
          if (unit.id === object.unit_id) {
            unit.checked = true;
          }
        });
      });

      vm.units = units;
      setState('permissions');

      return Users.read(user.id);
    })
    .then(function (user) {
      vm.user = user;
    })
    .catch(handler)
    .finally();
  }

  function checkboxOffset(depth) {
    return {
      'padding-left' : 30 * depth + 'px'
    };
  }

  // make sure that the passwords exist and match.
  function validPassword() {
    return vm.user.password &&
      vm.user.passwordVerify &&
      vm.user.password.length &&
      vm.user.passwordVerify.length &&
      vm.user.password === vm.user.passwordVerify;
  }

  // opens a new modal that
  function setPasswordModal() {
    var modal = $modal.open({
      templateUrl: 'partials/permissions/permissionsPasswordModalTemplate.html',
      backdrop:    'static',
      keyboard:    false,
      controller:  'PermissionsPasswordModalController',
      controllerAs : 'ModalCtrl',
      resolve:     {
        user:      vm.user
      }
    }).instance;
  }

  // submit the data to the server in a generic fashion
  function submit(invalid) {
    if (invalid) { return; }

    var promise;

    // decide how to submit
    switch (vm.state) {
      case 'create':
        promise = Users.create(vm.user);
        break;
      case 'update':
        promise = Users.update(vm.user.id, vm.user);
        break;
      case 'permissions':
        var permissions = vm.units.filter(function (u) {
          return u.checked;
        })
        .map(function (u) {
          return u.id;
        });

        promise = Users.updatePermissions(vm.user.id, permissions);
        break;
      default:
        break;
    }

    promise.then(function (data) {

      // go back to default state
      setState('success');
    })
    .catch(function (error) {
      console.log(error);
      vm.formMessage = error;
    });
  }

  // called on modules start
  function startup() {

    // load users
    Users.read().then(function (users) {
      vm.uiGridOptions.data = users;
    });

    // load projects
    Projects.read().then(function (data) {
      vm.projects = data;
    });
  }

  // loads tree units on demand
  function loadUnits() {
    return $http.get('/units')
    .then(util.unwrapHttpResponse);
  }

  // toggle the selection all child nodes
  function toggleUnitChildren(unit, children) {
    children.forEach(function (node) {
      node.checked = unit.checked;
      if (node.children) {
        toggleUnitChildren(node, node.children);
      }
    });
  }

  function toggleSuperUserPermissions() {
    vm.units.forEach(function (node) {
      node.checked = vm.super;
      if (node.children) {
        toggleUnitChildren(node, node.children);
      }
    });
  }

  startup();
}
