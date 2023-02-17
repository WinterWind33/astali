// Copyright (C) 2023 Andrea Ballestrazzi

// Production classes
import 'package:astali/astali_app.dart';
import 'package:astali/cards-management/bulletin-board-cards/presentation/bulletin_board_card.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';

void main() {
  group("Bulletin board", () {
    group("When the user taps on the add-card button", () {
      testWidgets("Then a card should be spawned", (widgetTester) async {
        await widgetTester.pumpWidget(const AstaliApp());

        await widgetTester.tap(find.byIcon(Icons.add));
        await widgetTester.pump();

        final cardFinder = find.byWidgetPredicate((widget) {
          return widget is BulletinBoardCard;
        });

        expect(cardFinder, findsOneWidget);
      });
    });
  });
}
