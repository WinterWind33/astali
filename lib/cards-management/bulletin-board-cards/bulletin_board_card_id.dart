// Copyright (C) 2023 Andrea Ballestrazzi

import 'package:flutter/material.dart'; // for Key

/// The ID of a bulletin board card.
typedef BulletinBoardCardID = int;

/// Represents the basic interface of an ID generator
/// for a bulletin board card.
abstract class BulletinBoardCardIDGenerator {
  /// Generates a card ID.
  BulletinBoardCardID generateID();
}

/// Simple Card ID generator that generates a new and unique ID for each call.
/// The uniqueness is object-wide, so multiple generators may generate the same ID
/// but one generator can't generate two equal IDs.
class BulletinBoardCardIDSimpleGenerator
    implements BulletinBoardCardIDGenerator {
  BulletinBoardCardIDSimpleGenerator() : _currentCardID = 0;

  @override
  BulletinBoardCardID generateID() {
    // We reserve the zero for future uses. We start from 1.
    _currentCardID++;

    return _currentCardID;
  }

  BulletinBoardCardID _currentCardID;
}

/// Represents the key used to create new bulletin board cards using their cardID.
class BulletinBoardCardKey implements ValueKey<BulletinBoardCardID> {
  const BulletinBoardCardKey(final BulletinBoardCardID cardID)
      : _cardID = cardID,
        super();

  @override
  get value => _cardID;

  final BulletinBoardCardID _cardID;

  /// Utility function used to retrieve the ID from the given key.
  /// NOTE: the given input key must be a bulletin board key.
  static BulletinBoardCardID retrieveIDFromKey(Key cardKey) {
    return (cardKey as BulletinBoardCardKey).value;
  }
}
