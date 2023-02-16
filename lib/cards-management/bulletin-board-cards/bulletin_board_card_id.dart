// Copyright (C) 2023 Andrea Ballestrazzi

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
