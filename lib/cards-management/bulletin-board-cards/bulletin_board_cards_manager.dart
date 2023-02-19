// Copyright (c) 2023 Andrea Ballestrazzi
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_selection_controller.dart';

import 'presentation/bulletin_board_card.dart';
import 'bulletin_board_card_id.dart';

import 'package:astali/input-management/pointer_events.dart';

typedef BulletinBoardCards = Map<BulletinBoardCardID, BulletinBoardCard>;

class BulletinBoardCardDataDiff {
  BulletinBoardCardDataDiff({this.newMousePoint});
  MousePoint? newMousePoint;

  BulletinBoardCard applyCardDiff(BulletinBoardCard oldCard) {
    BulletinBoardCardID oldCardID = oldCard.cardID;
    BulletinBoardCardSafeSelectionController oldSelectionController =
        oldCard.safeSelectionController;

    if (newMousePoint != null) {
      return BulletinBoardCard(
        cardID: oldCardID,
        safeSelectionController: oldSelectionController,
        cardPosition: newMousePoint!,
      );
    }

    return oldCard;
  }
}

abstract class BulletinBoardCardsManager {
  BulletinBoardCards getBulletinBoardCards();

  void addCard(BulletinBoardCard newCard);

  void updateCard(
      BulletinBoardCardID cardID, BulletinBoardCardDataDiff cardDataDiff);

  void deleteCard(BulletinBoardCardID cardID);
}

class BulletinBoardCardsManagerImpl implements BulletinBoardCardsManager {
  BulletinBoardCardsManagerImpl() : _bulletinBoardCards = {};

  @override
  void addCard(BulletinBoardCard newCard) {
    assert(!_containsCard(newCard.cardID));

    _bulletinBoardCards.putIfAbsent(newCard.cardID, () => newCard);
  }

  @override
  void deleteCard(BulletinBoardCardID cardID) {
    assert(_containsCard(cardID));

    _bulletinBoardCards.remove(cardID);
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

  final BulletinBoardCards _bulletinBoardCards;
}
