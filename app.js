var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('express-session');
var passport = require('passport');
var _ = require('lodash');
var helmet = require('helmet');
var GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CONSUMER_KEY,
    clientSecret: process.env.GOOGLE_CONSUMER_SECRET,
    callbackURL: 'https://' + process.env.HOSTED_DOMAIN + '/auth/google/return',
    hostedDomain: process.env.EMAIL_DOMAIN // added, but could be stripped via a client side MITM attack
  },
  function(identifier, err, profile, done) {
    if (err) {
      console.error(err);
      return done(err);
    }

    // add string prototype
    String.prototype.endsWith = function(suffix) {
      return this.indexOf(suffix, this.length - suffix.length) !== -1;
    };

    // find the account email
    var email = _.find(profile.emails, {
      type: 'account'
    });

    // if it ends with the string
    if (email.value.endsWith('@' + process.env.EMAIL_DOMAIN)) {
      console.log('LOGGED IN USER ' + email.value + '.');

      // then log them in
      return done(null, email.value);
    }

    // otherwise flip out
    else {
      // about their invalid domain
      return done(new Error('Invalid domain.'));
    }
  }
));

passport.serializeUser(function(id, done) {
  done(null, id);
});

passport.deserializeUser(function(id, done) {
  done(null, id);
});

var routes = require('./routes/index');

var app = express();

// Allow ips from ELB
app.enable('trust proxy');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Add Helmet measures
app.use(helmet.xssFilter());
app.use(helmet.xframe());
app.use(helmet.hidePoweredBy({ setTo: 'PHP 4.2.0' }));
app.use(helmet.hsts({ maxAge: 123000 }));
app.use(helmet.nosniff());
app.use(helmet.ienoopen());

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { secure: true }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(require('less-middleware')(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);

var scope = [
  'https://www.googleapis.com/auth/plus.profile.emails.read',
  'https://www.googleapis.com/auth/plus.login'
];

// Redirect the user to Google for authentication.  When complete, Google
// will redirect the user back to the application at
//     /auth/google/return
app.get('/auth/google', function(req, res, next) {
  req.session.next = req.query.next;
  next();
}, passport.authenticate('google', {
  scope: scope,
  hostedDomain: process.env.EMAIL_DOMAIN
}));

// Google will redirect the user to this URL after authentication.  Finish
// the process by verifying the assertion.  If valid, the user will be
// logged in.  Otherwise, authentication has failed.
app.get('/auth/google/return', passport.authenticate('google', {
  scope: scope,
  hostedDomain: process.env.EMAIL_DOMAIN,
  failureRedirect: '/failed'
}), function(req, res) {
  res.redirect(req.session.next);
  delete req.session.next;
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});


module.exports = app;
