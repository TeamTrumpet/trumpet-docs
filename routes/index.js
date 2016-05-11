var express = require('express');
var router = express.Router();
var aglio = require('aglio');
var github = require('octonode');

var NodeCache = require("node-cache");
var cache = new NodeCache();

cache.wrap = function(key, work, done) {
  this.get(key, (err, value) => {
    if (err) {
      return done(err);
    }

    if (value !== undefined) {
      return done(null, value);
    }

    work((err, value) => {
      if (err) {
        return done(err);
      }

      this.set(key, value, (err) => {
        if (err) {
          return done(err);
        }

        return done(err, value);
      });
    });
  });
};

var ensureAuthenticated = function(req, res, next) {
  return next();

  if (req.isAuthenticated())
    return next();
  else
    return res.redirect('/auth/google?next=' + req.url);
};

router.get('/', ensureAuthenticated, function(req, res) {
  // if some params are specified
  if (req.query.owner || req.query.repository || req.query.ref) {

    // then check if all are specified
    if (req.query.owner && req.query.repository && req.query.ref) {
      // then check if this is swagger
      if ('swagger' in req.query) {
        return res.redirect('/swagger/docs/' + req.query.owner + '/' + req.query.repository + '?ref=' + req.query.ref);
      }

      // if they are, then send them on to the docs
      return res.redirect('/docs/' + req.query.owner + '/' + req.query.repository + '?ref=' + req.query.ref);
    }

    var owner = process.env.DEFAULT_OWNER;

    if (req.query.owner) {
      owner = req.query.owner;
    }

    // otherwise, there's an issue
    return res.render('index', { error: true, owner: owner, repository: req.query.repository, ref: req.query.ref, swagger: "swagger" in req.query });

  }

  return res.render('index', { error: false, owner: process.env.DEFAULT_OWNER, repository: "", ref: "master", swagger: false });
});

var generateCacheKey = (repo, ref) => `${repo}?ref=${ref}`;
var generateSwaggerCacheKey = (repo, ref) => `swagger/${generateCacheKey(repo, ref)}`;

var retrieveDoc = (repo, ref, path) => (callback) => {
  var client = github.client(process.env.GITHUB_TOKEN);

  var ghrepo = client.repo(repo);

  ghrepo.contents(path ? path : process.env.DOCS_PATH, ref, function(err, data) {
    if (err) {
      return callback(err);
    }

    var doc = new Buffer(data.content, 'base64').toString('utf8');

    callback(null, doc);
  });
};

var generateDocsHTML = (repo, ref) => (callback) => {
  var retriever = retrieveDoc(repo, ref);

  retriever((err, doc) => {
    if (err) {
      return callback(err);
    }

    var options = {};

    aglio.render(doc, options, function(err, html) {
        if (err) {
          return callback(err);
        }

        // ensure all assets are https
        html = html.replace(/http\:\/\//g, 'https://');

        return callback(null, html);
    });
  });
};

var loadRepoDetails = (req, res, next) => {
  req.repo = `${req.params.owner}/${req.params.repository}`;
  req.ref = 'master';

  if (req.query.ref) {
    req.ref = req.query.ref;
  }

  next();
}

router.get('/docs/:owner/:repository', ensureAuthenticated, loadRepoDetails, function(req, res, next) {
  cache.wrap(generateCacheKey(req.repo, req.ref), generateDocsHTML(req.repo, req.ref), (err, html) => {
    if (err) {
      return next(err);
    }

    return res.send(html);
  });
});

router.get('/swagger/docs/:owner/:repository/swagger.yaml', ensureAuthenticated, loadRepoDetails, (req, res, next) => {
  cache.wrap(`swagger/${req.repo}?ref=${req.ref}`, retrieveDoc(req.repo, req.ref, 'swagger.yaml'), (err, doc) => {
    if (err) {
      return next(err);
    }

    res.header('Content-Type', 'application/x-yaml');
    res.send(doc);
  });
});

router.get('/swagger/docs/:owner/:repository', ensureAuthenticated, loadRepoDetails, (req, res, next) => {
  res.render('swagger', {
    url: req.query.baseUrl ? req.query.baseUrl : "swagger.yaml"
  });
});

router.post('/', function(req, res) {
  if (req.query.all) {
    cache.flushAll();
    return res.status(204).end();
  }

  if (req.get('X-GitHub-Event') === 'push') {

    var repo = req.body.repository.full_name;
    var ref = 'master';

    // if the push event has a ref
    if (req.body.ref) {
      // Example Procedure
      // req.body.ref === 'refs/heads/develop'
      // refsplit = ['refs', 'heads', 'develop']
      // ref = 'develop'
      var refsplit = req.body.ref.split('/');

      // and it has three components
      if (refsplit.length == 3) {
        // then we'll update our ref to that last piece
        ref = refsplit[2];
      }
    }

    // and delete the cache element
    cache.del(generateCacheKey(repo, ref));
    cache.del(generateSwaggerCacheKey(repo, ref));
  }

  return res.status(200).end();
});

module.exports = router;
