var express = require('express');
var app = express();
var db = require('./loginDb');
var bodyParser = require('body-parser');
var uuid = require('uuid/v4');
var bcrypt = require('bcrypt-nodejs');
var jwt = require('jsonwebtoken');

const jwtSecret = 'NvKLKAzkRzYHUrLbOdszw5jDLxP4hLzMoFTNBxjpIB5ZCOp8jFo5mROzDMLkDtlYtSbg4xtCrYNTYzmxnlIDOuAl1eqJ2G1XhvwiTZ4ALnGJsfxya3By2IIhgfkzogYSaOaI9RYJfWmy5UkKpOZ9UITyDD202W5Un1Q0TOE3zr263m9QcOTsXvLaelHciUCh3Op28adKGOkD89tO9WFHTpEyRWefT5DifkEwFcuwIowaN9SkcPGKE6fEOksMiwR0';
const cacheTimeout = 15 * 60 * 1000;
const invalid = 'Invalid username or password';
const needsUser = 'Authentication Required';
const noAccess = 'Access Denied';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

app.set('port', (process.env.PORT || 5000));

app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');

app.get('/', function(req, res) {
  res.sendfile('public/index.html', { root: __dirname });
});

app.get('/library/*', function (req, res) {
  res.sendfile('public/index.html', { root: __dirname });
});

app.all('/api/*', function(req, res, next) {
    res.header('Cache-Control','no-cache, no-store, must-revalidate');
    res.header('Expires','0');
    res.header('Pragma','no-cache');
    getSession(req, res, next);
});

app.get('/api/user', function (req, res) {
    res.json(req.user);
});

app.post('/api/user', function (req, res) {
    if (req.body.password) bcrypt.hash(req.body.password, null, null, function(err, hash) {
        if (err) { console.log('POST ' + req.url + ' - ERROR: ' + err); res.json({error: err}); return; }
        req.body.passwordhash = hash;
        db.users.create(req.body, function (createError, createResult) {
            if (createError) {
                console.log('POST ' + req.url + ' - ERROR: ' + createError); res.json({error: createError});
                return;
            }
            addSession(res, createResult.rows[0]);
        });
    });
});

app.put('/api/user', function (req, res) {
	if (!req.user) { console.log('PUT ' + req.url + ' - ERROR: ' + needsUser); res.json({error: needsUser}); return; }
	if (req.body.password) bcrypt.hash(req.body.password, null, null, function(err, hash) {
        if (err) { console.log('PUT ' + req.url + ' - ERROR: ' + err); res.json({error:err}); return; }
        req.body.passwordhash = hash;
        db.users.update(req.user.userid, req.body, function(err, result) {
            if (err) { console.log('PUT ' + req.url + ' - ERROR: ' + err); res.json({error:err}); return; }
            res.json(result.rows[0]);
        });
	});
});

app.post('/api/session', function (req, res) {
	db.users.getByLogonName(req.body.logonname, function(err, result) {
		if (err) { console.log('POST ' + req.url + ' - ERROR: ' + err); res.json({error: err}); return; }

		if (!result || !result.rows || result.rows.length <= 0) { res.json({error:invalid}); return; }
		bcrypt.compare(req.body.password, result.rows[0].passwordhash, function(err, match) {
            if (err) { console.log('POST /api/session - ERROR: ' + err); res.json({error: err}); return; }
            if (!match) { res.json({error: invalid}); return; }
            addSession(res, result.rows[0]);
		});
	})
});

app.delete('/api/session', function (req, res) {
    console.log('DELETE /api/session - Nothing to delete with JWT');
});

app.post('/api/search/:type(book|keyword|author|publisher)', function (req, res) {
    if (req.body.id && req.body.by) {
        db.all[req.params.type].parentSearch(req.body.by, req.body.id, function (err, result) { handleSearchResult(res, err, result); });
    } else if (req.body.query) {
        db.all[req.params.type].bookSearch(req.body.query, req.body.exactSearch, function (err, result) { handleSearchResult(res, err, result); });
    } else {
		res.json({rows: []});
	}
});

app.get('/api/:type(book|keyword|author|publisher)/:id([0-9]+)', function (req, res) {
    db.all[req.params.type].get(req.params.id, function(err, result) {
        if (err) { console.log('GET ' + req.url + ' - ERROR: ' + err); res.json({error: err}); return; }
        res.json(result.rows.length == 0 ? null : result.rows[0]);
    })
});

app.get('/api/:type(book|keyword|author|publisher)', function (req, res) {
    db.all[req.params.type].get(function(err, result) {
        if (err) { console.log('GET ' + req.url + ' - ERROR: ' + err); res.json({error: err}); return; }
        res.json(result.rows);
    })
});

app.post('/api/:type(book|keyword|author|publisher)', function (req, res) {
    if (!req.user) { console.log('POST ' + req.url + ' - ERROR: ' + needsUser); res.json({error: needsUser}); return; }
    if (req.params.type != 'keyword' && !req.user.isadmin) { console.log('POST ' + req.url + ' - ERROR: ' + noAccess); res.json({error: noAccess}); return; }

    db.all[req.params.type].create(req.body, function(err, result) {
        if (err) { console.log('POST ' + req.url + ' - ERROR: ' + err); res.json({error: err}); return; }
        res.json(result.rows.length == 0 ? null : result.rows[0]);
    })
});

app.put('/api/:type(book|keyword|author|publisher)/:id([0-9]+)', function (req, res) {
    if (!req.user) { console.log('PUT ' + req.url + ' - ERROR: ' + needsUser); res.json({error: needsUser}); return; }
    if (!req.user.isadmin) { console.log('PUT ' + req.url + ' - ERROR: ' + noAccess); res.json({error: noAccess}); return; }

    db.all[req.params.type].update(req.params.id, req.body, function(err, result) {
        if (err) { console.log('PUT ' + req.url + ' - ERROR: ' + err); res.json({error: err}); return; }
        res.json(result.rows.length == 0 ? null : result.rows[0]);
    })
});

app.delete('/api/:type(book|keyword|author|publisher)/:id([0-9]+)', function (req, res) {
    if (!req.user) { console.log('DELETE ' + req.url + ' - ERROR: ' + needsUser); res.json({error: needsUser}); return; }
    if (req.params.type != 'keyword' && !req.user.isadmin) { console.log('DELETE ' + req.url + ' - ERROR: ' + noAccess); res.json({error: noAccess}); return; }

    db.all[req.params.type].delete(req.params.id, function(err, result) {
        if (err) { console.log('DELETE ' + req.url + ' - ERROR: ' + err); res.json({error: err}); return; }
        res.json(result.rows);
    })
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

function getSession(req, res, next) {
    var authHeader = req.headers['authorization'];
    if (authHeader && /^Bearer /.test(authHeader)) {
        jwt.verify(authHeader.substring(7), jwtSecret, {}, function (err, user) {
            if (user && !err) {
                req.user = user;
                addSession(res, user, next);
            } else {
                console.log('Invalid authentication attempt - ' + err + '\n    ' + authHeader.substring(7));
                res.header('X-Reauth', 'true');
                next();
            }
        });
    } else {
        next();
    }
}
function addSession(res, user, callback) {
    delete user.exp;
    delete user.iat;
    jwt.sign(user, jwtSecret, {expiresIn:'15m'}, function (err, token) {
        if (err) {
            console.log("Could not sign user data - " + err);
            return;
        }

        if (typeof(callback) === 'function') {
            res.header('X-Auth-Refresh', token);
            callback();
        } else {
            var usr = {};
            Object.keys(user).forEach(function(key) { if (key != 'passwordhash') { usr[key] = user[key]; } });
            res.json({token:token, user:usr});
        }
    });
}

function handleSearchResult(res, err, result) {
	if (err) {
        console.log('handleSearchResult - ERROR: ' + err); res.json({error: err});
	} else {
		res.json({rows: result.rows});
	}
}