// Copyright (c) 2023 Andrea Ballestrazzi
import 'presentation/bulletin_board_card.dart';

import 'bulletin_board_card_selection_controller.dart';
import 'bulletin_board_card_id.dart';

import 'package:astali/input-management/pointer_events.dart';

// Core and engine
import 'package:flutter/material.dart';

typedef BulletinBoardCards = Map<BulletinBoardCardID, BulletinBoardCard>;

class BulletinBoardCardDataDiff {
  BulletinBoardCardDataDiff({this.newMousePoint});
  MousePoint? newMousePoint;

  BulletinBoardCard applyCardDiff(BulletinBoardCard oldCard) {
    BulletinBoardCardSafeSelectionController oldSelectionController =
        oldCard.safeSelectionController;
    OnCardDeleteEvent oldOnCardDeleteEvent = oldCard.onCardDeleteEvent;
    Key? oldKey = oldCard.key;

    if (newMousePoint != null) {
      return BulletinBoardCard(
        key: oldKey,
        safeSelectionController: oldSelectionController,
        cardPosition: newMousePoint!,
        onCardDeleteEvent: oldOnCardDeleteEvent,
      );
    }

    return oldCard;
  }
}

abstract class BulletinBoardCardsManagerEventListener {
  void onCardAdded(final BulletinBoardCard newCard);
  void onCardDeleted(final BulletinBoardCardID oldCardID);
}

abstract class BulletinBoardCardsManager {
  BulletinBoardCards getBulletinBoardCards();

  void registerEventListener(
      BulletinBoardCardsManagerEventListener eventListener);

  void addCard(BulletinBoardCard newCard);

  void updateCard(
      BulletinBoardCardID cardID, BulletinBoardCardDataDiff cardDataDiff);

  void deleteCard(BulletinBoardCardID cardID);
}

class BulletinBoardCardsManagerQuerist {
  const BulletinBoardCardsManagerQuerist(BulletinBoardCardsManager manager)
      : _cardsManager = manager;

  bool containsCard(final BulletinBoardCardID cardID) {
    return _cardsManager.getBulletinBoardCards().containsKey(cardID);
  }

  final BulletinBoardCardsManager _cardsManager;
}

class BulletinBoardCardsManagerImpl implements BulletinBoardCardsManager {
  BulletinBoardCardsManagerImpl() : _bulletinBoardCards = {};

  @override
  void registerEventListener(
      BulletinBoardCardsManagerEventListener eventListener) {
    _eventListener = eventListener;
  }

  @override
  void addCard(BulletinBoardCard newCard) {
    final BulletinBoardCardID cardID =
        BulletinBoardCardKey.retrieveIDFromKey(newCard.key!);
    assert(!_containsCard(cardID));

    final BulletinBoardCard newAddedCard =
        _bulletinBoardCards.putIfAbsent(cardID, () => newCard);

    _dispatchCardAdded(newAddedCard);
  }

  @override
  void deleteCard(BulletinBoardCardID cardID) {
    assert(_containsCard(cardID));

    _bulletinBoardCards.remove(cardID);

    _dispatchCardDeleted(cardID);
  }

  @override
  BulletinBoardCards getBulletinBoardCards() {
    return _bulletinBoardCards;
  }

  @override
  void updateCard(
      BulletinBoardCardID cardID, BulletinBoardCardDataDiff cardDataDiff) {
    assert(_containsCard(cardID));

    _bulletinBoardCards.update(
        cardID, (value) => cardDataDiff.applyCardDiff(value));
  }

  bool _containsCard(final BulletinBoardCardID cardID) {
    return _bulletinBoardCards.containsKey(cardID);
  }

  void _dispatchCardAdded(BulletinBoardCard newCard) {
    if (_eventListener != null) {
      _eventListener!.onCardAdded(newCard);
    }
  }

  void _dispatchCardDeleted(final BulletinBoardCardID cardID) {
    if (_eventListener != null) {
      _eventListener!.onCardDeleted(cardID);
    }
  }

  final BulletinBoardCards _bulletinBoardCards;
  BulletinBoardCardsManagerEventListener? _eventListener;
}
