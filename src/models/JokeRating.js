'use strict';
const mongoose = require('mongoose');

const jokeRatingSchema = new mongoose.Schema({
  jokeId: { type: String, required: true, unique: true },
  up:     { type: Number, default: 0 },
  down:   { type: Number, default: 0 },
  voters: { type: [String], default: [] }, // empêche de voter 2x sur la même blague
});

module.exports = mongoose.model('JokeRating', jokeRatingSchema);
